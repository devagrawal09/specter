import type {
  EnqueueReactionInput,
  EnqueueReactionResult,
  ReactionOutboxClaim,
  ReactionOutboxJob,
  ReactionOutboxStatus,
  ReactionOutboxStore,
} from '@specter-ts/reaction-outbox'
import { ReactionOutboxLeaseLostError } from '@specter-ts/reaction-outbox'

import {
  createPostgresDatabaseContext,
  postgresDate,
  postgresJson,
  postgresNumber,
  postgresString,
  type PostgresConnection,
  type PostgresDatabaseContext,
  type PostgresDatabaseOptions,
  type PostgresPool,
} from './database'

export type PostgresReactionOutboxOptions = PostgresDatabaseOptions & {
  readonly context?: PostgresDatabaseContext
}

export async function preparePostgresReactionOutbox(pool: PostgresPool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS specter_reaction_outbox (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    payload JSONB NOT NULL,
    status TEXT NOT NULL CHECK (
      status IN ('pending', 'running', 'completed', 'dead-letter')
    ),
    requested_at TIMESTAMPTZ NOT NULL,
    available_at TIMESTAMPTZ NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    active_attempt_id TEXT,
    lease_expires_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    last_error TEXT
  )`)
  await pool.query(`CREATE INDEX IF NOT EXISTS specter_reaction_outbox_pending_idx
    ON specter_reaction_outbox(status, available_at, requested_at, id)`)
}

export function createPostgresReactionOutboxStore<TPayload>(
  pool: PostgresPool,
  options: PostgresReactionOutboxOptions = {},
): ReactionOutboxStore<TPayload> {
  const context =
    options.context ?? createPostgresDatabaseContext(pool, options)

  function optionalString(value: unknown, field: string) {
    return value === null || value === undefined
      ? undefined
      : postgresString(value, field)
  }

  function optionalDate(value: unknown, field: string) {
    return value === null || value === undefined
      ? undefined
      : postgresDate(value, field)
  }

  function toJob(row: Record<string, unknown>): ReactionOutboxJob<TPayload> {
    return {
      id: postgresString(row.id, 'outbox job id'),
      idempotencyKey: postgresString(
        row.idempotency_key,
        'outbox idempotency key',
      ),
      payload: postgresJson<TPayload>(row.payload, 'outbox payload'),
      status: postgresString(
        row.status,
        'outbox status',
      ) as ReactionOutboxStatus,
      requestedAt: postgresDate(row.requested_at, 'outbox requested time'),
      availableAt: postgresDate(row.available_at, 'outbox available time'),
      attemptCount: postgresNumber(row.attempt_count, 'outbox attempt count'),
      activeAttemptId: optionalString(
        row.active_attempt_id,
        'outbox attempt id',
      ),
      leaseExpiresAt: optionalDate(
        row.lease_expires_at,
        'outbox lease expiration',
      ),
      completedAt: optionalDate(row.completed_at, 'outbox completion time'),
      lastError: optionalString(row.last_error, 'outbox error'),
    }
  }

  async function get(connection: PostgresConnection, jobId: string) {
    const result = await connection.query(
      'SELECT * FROM specter_reaction_outbox WHERE id = $1',
      [jobId],
    )
    return result.rows[0] ? toJob(result.rows[0]) : undefined
  }

  async function requireChanged(
    connection: PostgresConnection,
    sql: string,
    parameters: readonly unknown[],
    cause: Error,
  ) {
    const result = await connection.query(sql, [...parameters])
    if (result.rowCount !== 1) throw cause
  }

  return {
    enqueue(input: EnqueueReactionInput<TPayload>) {
      const payload = JSON.stringify(input.payload)
      if (payload === undefined) {
        throw new Error('Reaction outbox payload must be JSON-serializable')
      }
      return context.transaction(
        async (connection): Promise<EnqueueReactionResult<TPayload>> => {
          const result = await connection.query(
            `INSERT INTO specter_reaction_outbox (
              id,
              idempotency_key,
              payload,
              status,
              requested_at,
              available_at,
              attempt_count
            ) VALUES ($1, $2, $3::jsonb, 'pending', $4, $5, 0)
            ON CONFLICT (idempotency_key) DO NOTHING
            RETURNING *`,
            [
              input.id,
              input.idempotencyKey,
              payload,
              input.requestedAt,
              input.availableAt,
            ],
          )
          const row = result.rows[0]
          if (row) return { job: toJob(row), created: true }

          const existing = await connection.query(
            `SELECT * FROM specter_reaction_outbox
             WHERE idempotency_key = $1`,
            [input.idempotencyKey],
          )
          const existingRow = existing.rows[0]
          if (!existingRow) {
            throw new Error('Failed to read deduplicated Reaction outbox job')
          }
          return { job: toJob(existingRow), created: false }
        },
      )
    },

    claimNext(now, leaseExpiresAt) {
      return context.transaction(async (connection) => {
        const result = await connection.query(
          `SELECT * FROM specter_reaction_outbox
           WHERE status = 'pending' AND available_at <= $1
           ORDER BY available_at ASC, requested_at ASC, id ASC
           LIMIT 1
           FOR UPDATE SKIP LOCKED`,
          [now],
        )
        const row = result.rows[0]
        if (!row) return undefined
        const job = toJob(row)
        const attemptCount = job.attemptCount + 1
        const attemptId = `${job.id}:attempt:${attemptCount}`
        await requireChanged(
          connection,
          `UPDATE specter_reaction_outbox
           SET status = 'running',
             attempt_count = $1,
             active_attempt_id = $2,
             lease_expires_at = $3,
             completed_at = NULL
           WHERE id = $4 AND status = 'pending'`,
          [attemptCount, attemptId, leaseExpiresAt, job.id],
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
      return context.transaction((connection) =>
        requireChanged(
          connection,
          `UPDATE specter_reaction_outbox
           SET status = 'completed', active_attempt_id = NULL,
             lease_expires_at = NULL, completed_at = $1, last_error = NULL
           WHERE id = $2 AND status = 'running' AND active_attempt_id = $3`,
          [completedAt, jobId, attemptId],
          new ReactionOutboxLeaseLostError(attemptId),
        ),
      )
    },

    reschedule(jobId, attemptId, availableAt, error) {
      return context.transaction((connection) =>
        requireChanged(
          connection,
          `UPDATE specter_reaction_outbox
           SET status = 'pending', available_at = $1,
             active_attempt_id = NULL, lease_expires_at = NULL, last_error = $2
           WHERE id = $3 AND status = 'running' AND active_attempt_id = $4`,
          [availableAt, error, jobId, attemptId],
          new ReactionOutboxLeaseLostError(attemptId),
        ),
      )
    },

    deadLetter(jobId, attemptId, failedAt, error) {
      return context.transaction((connection) =>
        requireChanged(
          connection,
          `UPDATE specter_reaction_outbox
           SET status = 'dead-letter', active_attempt_id = NULL,
             lease_expires_at = NULL, completed_at = $1, last_error = $2
           WHERE id = $3 AND status = 'running' AND active_attempt_id = $4`,
          [failedAt, error, jobId, attemptId],
          new ReactionOutboxLeaseLostError(attemptId),
        ),
      )
    },

    requeueExpired(now) {
      return context.transaction(async (connection) => {
        const result = await connection.query(
          `UPDATE specter_reaction_outbox
           SET status = 'pending', available_at = $1,
             active_attempt_id = NULL, lease_expires_at = NULL,
             last_error = 'Reaction attempt lease expired'
           WHERE status = 'running'
             AND lease_expires_at IS NOT NULL
             AND lease_expires_at <= $1`,
          [now],
        )
        return result.rowCount ?? 0
      })
    },

    async nextWorkAt() {
      const result = await context.connection().query<{ wake_at: unknown }>(
        `SELECT MIN(wake_at) AS wake_at
           FROM (
             SELECT available_at AS wake_at
             FROM specter_reaction_outbox
             WHERE status = 'pending'
             UNION ALL
             SELECT lease_expires_at AS wake_at
             FROM specter_reaction_outbox
             WHERE status = 'running' AND lease_expires_at IS NOT NULL
           ) AS wakeups`,
      )
      const value = result.rows[0]?.wake_at
      return value === null || value === undefined
        ? undefined
        : postgresDate(value, 'next outbox availability')
    },

    get(jobId) {
      return get(context.connection(), jobId)
    },

    async list(status?: ReactionOutboxStatus) {
      const result = await context.connection().query(
        `SELECT * FROM specter_reaction_outbox
         ${status ? 'WHERE status = $1' : ''}
         ORDER BY requested_at ASC, id ASC`,
        status ? [status] : [],
      )
      return result.rows.map(toJob)
    },

    retryDeadLetter(jobId, availableAt) {
      return context.transaction((connection) =>
        requireChanged(
          connection,
          `UPDATE specter_reaction_outbox
           SET status = 'pending', available_at = $1,
             completed_at = NULL, last_error = NULL
           WHERE id = $2 AND status = 'dead-letter'`,
          [availableAt, jobId],
          new Error(`Reaction outbox job is not dead-lettered: ${jobId}`),
        ),
      )
    },
  }
}
