import type { Client } from '@libsql/client'
import type {
  EnqueueReactionInput,
  EnqueueReactionResult,
  ReactionOutboxClaim,
  ReactionOutboxJob,
  ReactionOutboxStatus,
  ReactionOutboxStore,
} from '@specter-ts/reaction-outbox'
import { ReactionOutboxLeaseLostError } from '@specter-ts/reaction-outbox'
import { Effect } from 'effect'

import {
  createSqliteDatabaseContext,
  requireNumber,
  requireString,
  type SqliteConnection,
  type SqliteDatabaseContext,
} from './database'

export type SqliteReactionOutboxOptions = {
  readonly context?: SqliteDatabaseContext
}

export async function prepareSqliteReactionOutbox(client: Client) {
  await client.batch(
    [
      `CREATE TABLE IF NOT EXISTS specter_reaction_outbox (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        payload TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN ('pending', 'running', 'completed', 'dead-letter')
        ),
        requested_at TEXT NOT NULL,
        available_at TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        active_attempt_id TEXT,
        lease_expires_at TEXT,
        completed_at TEXT,
        last_error TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS specter_reaction_outbox_pending_idx
        ON specter_reaction_outbox(status, available_at, requested_at, id)`,
    ],
    'write',
  )
}

export function createSqliteReactionOutboxStore<TPayload>(
  client: Client,
  options: SqliteReactionOutboxOptions = {},
): ReactionOutboxStore<TPayload> {
  const context = options.context ?? createSqliteDatabaseContext(client)

  function toDate(value: unknown, field: string) {
    const date = new Date(requireString(value, field))
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Expected SQLite ${field} to be an ISO-8601 timestamp`)
    }
    return date
  }

  function nullableDate(value: unknown, field: string) {
    return value === null ? undefined : toDate(value, field)
  }

  function nullableString(value: unknown, field: string) {
    return value === null ? undefined : requireString(value, field)
  }

  function toJob(row: Record<string, unknown>): ReactionOutboxJob<TPayload> {
    return {
      id: requireString(row.id, 'outbox job id'),
      idempotencyKey: requireString(
        row.idempotency_key,
        'outbox idempotency key',
      ),
      payload: JSON.parse(
        requireString(row.payload, 'outbox payload'),
      ) as TPayload,
      status: requireString(
        row.status,
        'outbox status',
      ) as ReactionOutboxStatus,
      requestedAt: toDate(row.requested_at, 'outbox requested time'),
      availableAt: toDate(row.available_at, 'outbox available time'),
      attemptCount: requireNumber(row.attempt_count, 'outbox attempt count'),
      activeAttemptId: nullableString(
        row.active_attempt_id,
        'outbox attempt id',
      ),
      leaseExpiresAt: nullableDate(
        row.lease_expires_at,
        'outbox lease expiration',
      ),
      completedAt: nullableDate(row.completed_at, 'outbox completion time'),
      lastError: nullableString(row.last_error, 'outbox error'),
    }
  }

  async function get(
    connection: SqliteConnection,
    jobId: string,
  ): Promise<ReactionOutboxJob<TPayload> | undefined> {
    const result = await connection.execute({
      sql: 'SELECT * FROM specter_reaction_outbox WHERE id = ?',
      args: [jobId],
    })
    return result.rows[0]
      ? toJob(result.rows[0] as Record<string, unknown>)
      : undefined
  }

  async function requireChanged(
    connection: SqliteConnection,
    sql: string,
    args: readonly (string | number | null)[],
    cause: Error,
  ) {
    const result = await connection.execute({ sql, args: [...args] })
    if (result.rowsAffected !== 1) throw cause
  }

  function runTransaction<A>(
    run: (connection: SqliteConnection) => Promise<A>,
  ): Promise<A> {
    return Effect.runPromise(
      context.transaction((connection) =>
        Effect.promise(() => run(connection)),
      ),
    )
  }

  return {
    enqueue(input: EnqueueReactionInput<TPayload>) {
      return runTransaction(
        async (connection): Promise<EnqueueReactionResult<TPayload>> => {
          const existing = await connection.execute({
            sql: `SELECT * FROM specter_reaction_outbox
              WHERE idempotency_key = ?`,
            args: [input.idempotencyKey],
          })
          if (existing.rows[0]) {
            return {
              job: toJob(existing.rows[0] as Record<string, unknown>),
              created: false,
            }
          }
          const payload = JSON.stringify(input.payload)
          if (payload === undefined) {
            throw new Error('Reaction outbox payload must be JSON-serializable')
          }
          await connection.execute({
            sql: `INSERT INTO specter_reaction_outbox (
                id,
                idempotency_key,
                payload,
                status,
                requested_at,
                available_at,
                attempt_count
              ) VALUES (?, ?, ?, 'pending', ?, ?, 0)`,
            args: [
              input.id,
              input.idempotencyKey,
              payload,
              input.requestedAt.toISOString(),
              input.availableAt.toISOString(),
            ],
          })
          const job = await get(connection, input.id)
          if (!job)
            throw new Error('Failed to read inserted Reaction outbox job')
          return { job, created: true }
        },
      )
    },

    claimNext(now, leaseExpiresAt) {
      return runTransaction(async (connection) => {
        const result = await connection.execute({
          sql: `SELECT * FROM specter_reaction_outbox
            WHERE status = 'pending' AND available_at <= ?
            ORDER BY available_at ASC, requested_at ASC, id ASC
            LIMIT 1`,
          args: [now.toISOString()],
        })
        const row = result.rows[0]
        if (!row) return undefined
        const job = toJob(row as Record<string, unknown>)
        const attemptCount = job.attemptCount + 1
        const attemptId = `${job.id}:attempt:${attemptCount}`
        await requireChanged(
          connection,
          `UPDATE specter_reaction_outbox
            SET status = 'running',
              attempt_count = ?,
              active_attempt_id = ?,
              lease_expires_at = ?,
              completed_at = NULL
            WHERE id = ? AND status = 'pending'`,
          [attemptCount, attemptId, leaseExpiresAt.toISOString(), job.id],
          new Error(`Reaction outbox job was claimed concurrently: ${job.id}`),
        )
        return {
          ...job,
          status: 'running',
          attemptCount,
          activeAttemptId: attemptId,
          leaseExpiresAt,
          completedAt: undefined,
        } satisfies ReactionOutboxClaim<TPayload>
      })
    },

    complete(jobId, attemptId, completedAt) {
      return runTransaction((connection) =>
        requireChanged(
          connection,
          `UPDATE specter_reaction_outbox
            SET status = 'completed',
              active_attempt_id = NULL,
              lease_expires_at = NULL,
              completed_at = ?,
              last_error = NULL
            WHERE id = ? AND status = 'running' AND active_attempt_id = ?`,
          [completedAt.toISOString(), jobId, attemptId],
          new ReactionOutboxLeaseLostError(attemptId),
        ),
      )
    },

    reschedule(jobId, attemptId, availableAt, error) {
      return runTransaction((connection) =>
        requireChanged(
          connection,
          `UPDATE specter_reaction_outbox
            SET status = 'pending',
              available_at = ?,
              active_attempt_id = NULL,
              lease_expires_at = NULL,
              last_error = ?
            WHERE id = ? AND status = 'running' AND active_attempt_id = ?`,
          [availableAt.toISOString(), error, jobId, attemptId],
          new ReactionOutboxLeaseLostError(attemptId),
        ),
      )
    },

    deadLetter(jobId, attemptId, failedAt, error) {
      return runTransaction((connection) =>
        requireChanged(
          connection,
          `UPDATE specter_reaction_outbox
            SET status = 'dead-letter',
              active_attempt_id = NULL,
              lease_expires_at = NULL,
              completed_at = ?,
              last_error = ?
            WHERE id = ? AND status = 'running' AND active_attempt_id = ?`,
          [failedAt.toISOString(), error, jobId, attemptId],
          new ReactionOutboxLeaseLostError(attemptId),
        ),
      )
    },

    requeueExpired(now) {
      return runTransaction(async (connection) => {
        const result = await connection.execute({
          sql: `UPDATE specter_reaction_outbox
            SET status = 'pending',
              available_at = ?,
              active_attempt_id = NULL,
              lease_expires_at = NULL,
              last_error = 'Reaction attempt lease expired'
            WHERE status = 'running'
              AND lease_expires_at IS NOT NULL
              AND lease_expires_at <= ?`,
          args: [now.toISOString(), now.toISOString()],
        })
        return result.rowsAffected
      })
    },

    async nextWorkAt() {
      const result = await context.client.execute(
        `SELECT MIN(wake_at) AS wake_at
          FROM (
            SELECT available_at AS wake_at
            FROM specter_reaction_outbox
            WHERE status = 'pending'
            UNION ALL
            SELECT lease_expires_at AS wake_at
            FROM specter_reaction_outbox
            WHERE status = 'running' AND lease_expires_at IS NOT NULL
          )`,
      )
      const value = result.rows[0]?.wake_at
      return value === null || value === undefined
        ? undefined
        : new Date(requireString(value, 'next outbox availability'))
    },

    get(jobId) {
      return get(context.client, jobId)
    },

    async list(status?: ReactionOutboxStatus) {
      const result = await context.client.execute({
        sql: `SELECT * FROM specter_reaction_outbox
          ${status ? 'WHERE status = ?' : ''}
          ORDER BY requested_at ASC, id ASC`,
        args: status ? [status] : [],
      })
      return result.rows.map((row) => toJob(row as Record<string, unknown>))
    },

    retryDeadLetter(jobId, availableAt) {
      return runTransaction((connection) =>
        requireChanged(
          connection,
          `UPDATE specter_reaction_outbox
            SET status = 'pending',
              available_at = ?,
              completed_at = NULL,
              last_error = NULL
            WHERE id = ? AND status = 'dead-letter'`,
          [availableAt.toISOString(), jobId],
          new Error(`Reaction outbox job is not dead-lettered: ${jobId}`),
        ),
      )
    },
  }
}
