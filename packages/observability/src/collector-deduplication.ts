import {
  createClient,
  type Client,
  type Transaction,
} from '@libsql/client/sqlite3'
import type {
  RuntimeObservation,
  RuntimeObservationBatch,
} from '@specter-ts/protocol'

const reservationLeaseMs = 5 * 60 * 1_000
const transactionTails = new WeakMap<Client, Promise<void>>()

export type ObservationReservation = {
  readonly reservationId: string
  readonly batch: RuntimeObservationBatch
  readonly duplicates: number
}

export type ObservationReservationResult =
  | {
      readonly status: 'reserved'
      readonly reservation: ObservationReservation
    }
  | { readonly status: 'busy' }

export async function prepareObservationDeduplication(
  client: Client,
  now = new Date(),
  segmentPaths: readonly string[] = [],
) {
  await client.execute(`CREATE TABLE IF NOT EXISTS accepted_observations (
    source_key TEXT NOT NULL,
    observation_id TEXT NOT NULL,
    accepted_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'accepted',
    reservation_id TEXT,
    PRIMARY KEY (source_key, observation_id)
  )`)
  const columns = await client.execute(
    'PRAGMA table_info(accepted_observations)',
  )
  const columnNames = new Set(columns.rows.map((row) => String(row.name)))
  if (!columnNames.has('status')) {
    await client.execute(
      "ALTER TABLE accepted_observations ADD COLUMN status TEXT NOT NULL DEFAULT 'accepted'",
    )
  }
  if (!columnNames.has('reservation_id')) {
    await client.execute(
      'ALTER TABLE accepted_observations ADD COLUMN reservation_id TEXT',
    )
  }

  await reconcileObservationReservations(client, segmentPaths, now)
  await client.execute({
    sql: "DELETE FROM accepted_observations WHERE status = 'accepted' AND accepted_at < ?",
    args: [new Date(now.getTime() - 48 * 60 * 60 * 1_000).toISOString()],
  })
}

async function reconcileObservationReservations(
  client: Client,
  segmentPaths: readonly string[],
  now: Date,
) {
  const outstanding = await client.execute(
    "SELECT source_key, observation_id FROM accepted_observations WHERE status = 'reserved'",
  )
  if (outstanding.rows.length === 0) return

  const persisted = new Set<string>()
  const pending = new Set(
    outstanding.rows.map((row) =>
      observationIdentity(String(row.source_key), String(row.observation_id)),
    ),
  )

  for (const path of segmentPaths) {
    if (pending.size === 0) break
    const segment = createClient({ url: `file:${path}` })
    try {
      const events = await segment.execute({
        sql: "SELECT payload FROM specter_events WHERE type = 'runtime-observation-recorded'",
        args: [],
      })
      for (const row of events.rows) {
        const observation = persistedObservation(row.payload)
        const identity = observationIdentity(
          sourceKey(observation),
          observation.observationId,
        )
        if (!pending.delete(identity)) continue
        persisted.add(identity)
      }
    } finally {
      segment.close()
    }
  }

  await withWriteTransaction(client, async (transaction) => {
    for (const row of outstanding.rows) {
      const key = String(row.source_key)
      const observationId = String(row.observation_id)
      const identity = observationIdentity(key, observationId)
      if (persisted.has(identity)) {
        await transaction.execute({
          sql: "UPDATE accepted_observations SET status = 'accepted', reservation_id = NULL, accepted_at = ? WHERE source_key = ? AND observation_id = ? AND status = 'reserved'",
          args: [now.toISOString(), key, observationId],
        })
      } else {
        await transaction.execute({
          sql: "DELETE FROM accepted_observations WHERE source_key = ? AND observation_id = ? AND status = 'reserved'",
          args: [key, observationId],
        })
      }
    }
  })
}

export async function reserveObservations(
  batch: RuntimeObservationBatch,
  client: Client,
  reservationId: string,
  now = new Date(),
): Promise<ObservationReservationResult> {
  return withWriteTransaction(client, async (transaction) => {
    const pending: Array<{
      readonly observation: RuntimeObservation
      readonly key: string
      readonly reclaim: boolean
    }> = []
    const pendingKeys = new Set<string>()
    let duplicates = 0
    const reservedAt = now.toISOString()
    const staleBefore = new Date(
      now.getTime() - reservationLeaseMs,
    ).toISOString()

    for (const observation of batch.observations) {
      const key = sourceKey(observation)
      const identity = `${key}\u0000${observation.observationId}`
      if (pendingKeys.has(identity)) {
        duplicates += 1
        continue
      }
      const existing = await transaction.execute({
        sql: 'SELECT status, accepted_at FROM accepted_observations WHERE source_key = ? AND observation_id = ?',
        args: [key, observation.observationId],
      })
      const row = existing.rows[0]
      if (!row) {
        pending.push({ observation, key, reclaim: false })
        pendingKeys.add(identity)
        continue
      }
      if (String(row.status) === 'accepted') {
        duplicates += 1
        continue
      }
      if (
        String(row.status) === 'reserved' &&
        String(row.accepted_at) < staleBefore
      ) {
        pending.push({ observation, key, reclaim: true })
        pendingKeys.add(identity)
        continue
      }
      return { status: 'busy' }
    }

    for (const item of pending) {
      await transaction.execute({
        sql: item.reclaim
          ? "UPDATE accepted_observations SET accepted_at = ?, reservation_id = ? WHERE source_key = ? AND observation_id = ? AND status = 'reserved'"
          : "INSERT INTO accepted_observations (accepted_at, reservation_id, source_key, observation_id, status) VALUES (?, ?, ?, ?, 'reserved')",
        args: [
          reservedAt,
          reservationId,
          item.key,
          item.observation.observationId,
        ],
      })
    }

    return {
      status: 'reserved',
      reservation: {
        reservationId,
        batch: {
          ...batch,
          observations: pending.map((item) => item.observation),
        },
        duplicates,
      },
    }
  })
}

export async function acceptObservationReservation(
  reservation: ObservationReservation,
  accepted: readonly RuntimeObservation[],
  client: Client,
  now = new Date(),
) {
  await withWriteTransaction(client, async (transaction) => {
    for (const observation of accepted) {
      const result = await transaction.execute({
        sql: "UPDATE accepted_observations SET status = 'accepted', reservation_id = NULL, accepted_at = ? WHERE source_key = ? AND observation_id = ? AND status = 'reserved' AND reservation_id = ?",
        args: [
          now.toISOString(),
          sourceKey(observation),
          observation.observationId,
          reservation.reservationId,
        ],
      })
      if (result.rowsAffected !== 1) {
        throw new Error('Observation reservation ownership was lost')
      }
    }
  })
}

export async function releaseObservationReservation(
  reservation: ObservationReservation,
  client: Client,
) {
  await withWriteTransaction(client, async (transaction) => {
    await transaction.execute({
      sql: "DELETE FROM accepted_observations WHERE status = 'reserved' AND reservation_id = ?",
      args: [reservation.reservationId],
    })
  })
}

async function withWriteTransaction<Result>(
  client: Client,
  run: (transaction: Transaction) => Promise<Result>,
) {
  const previous = transactionTails.get(client) ?? Promise.resolve()
  let release = () => {}
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const queued = previous.then(() => current)
  transactionTails.set(client, queued)
  await previous

  let transaction: Transaction | undefined
  try {
    transaction = await client.transaction('write')
    const result = await run(transaction)
    await transaction.commit()
    return result
  } catch (cause) {
    if (transaction && !transaction.closed) await transaction.rollback()
    throw cause
  } finally {
    transaction?.close()
    release()
    if (transactionTails.get(client) === queued) transactionTails.delete(client)
  }
}

function sourceKey(observation: RuntimeObservation) {
  const source = observation.source
  return JSON.stringify([
    source.application,
    source.environment,
    source.runtimeLanguage,
    source.runtimeVersion,
    source.instanceId,
    source.eventLogId,
  ])
}

function observationIdentity(source: string, observationId: string) {
  return `${source}\u0000${observationId}`
}

function persistedObservation(payload: unknown): RuntimeObservation {
  if (typeof payload !== 'string') {
    throw new Error('Expected persisted observability Event payload to be JSON')
  }
  const decoded: unknown = JSON.parse(payload)
  if (!decoded || typeof decoded !== 'object') {
    throw new Error('Expected persisted observability Event payload object')
  }
  const observation = Reflect.get(decoded, 'observation')
  if (!observation || typeof observation !== 'object') {
    throw new Error('Expected persisted runtime observation')
  }
  const observationId = Reflect.get(observation, 'observationId')
  const source = Reflect.get(observation, 'source')
  if (
    typeof observationId !== 'string' ||
    !source ||
    typeof source !== 'object' ||
    [
      'application',
      'environment',
      'runtimeLanguage',
      'runtimeVersion',
      'instanceId',
      'eventLogId',
    ].some((field) => typeof Reflect.get(source, field) !== 'string')
  ) {
    throw new Error('Expected persisted runtime observation identity')
  }
  return observation as RuntimeObservation
}
