import {
  ReactionOutboxLeaseLostError,
  type EnqueueReactionInput,
  type ReactionOutboxClaim,
  type ReactionOutboxJob,
  type ReactionOutboxStatus,
  type ReactionOutboxStore,
} from '@specter-ts/reaction-outbox'
import type { SQLInputValue } from 'node:sqlite'

import {
  type NodeSqliteContext,
  requireNumber,
  requireString,
} from './database'

export function prepareNodeSqliteReactionOutbox(context: NodeSqliteContext) {
  context.database.exec(`
    CREATE TABLE IF NOT EXISTS specter_reaction_outbox (
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
    );
    CREATE INDEX IF NOT EXISTS specter_reaction_outbox_pending_idx
      ON specter_reaction_outbox(status, available_at, requested_at, id);
  `)
}

export function createNodeSqliteReactionOutboxStore<TPayload>(
  context: NodeSqliteContext,
): ReactionOutboxStore<TPayload> {
  function date(value: unknown, field: string) {
    const parsed = new Date(requireString(value, field))
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Expected ${field} ISO-8601 timestamp`)
    }
    return parsed
  }

  function optionalDate(value: unknown, field: string) {
    return value === null ? undefined : date(value, field)
  }

  function optionalString(value: unknown, field: string) {
    return value === null ? undefined : requireString(value, field)
  }

  function toJob(row: Record<string, unknown>): ReactionOutboxJob<TPayload> {
    return {
      id: requireString(row.id, 'outbox job id'),
      idempotencyKey: requireString(
        row.idempotency_key,
        'outbox idempotency key',
      ),
      payload: JSON.parse(requireString(row.payload, 'outbox payload')),
      status: requireString(
        row.status,
        'outbox status',
      ) as ReactionOutboxStatus,
      requestedAt: date(row.requested_at, 'outbox requested time'),
      availableAt: date(row.available_at, 'outbox available time'),
      attemptCount: requireNumber(row.attempt_count, 'outbox attempt count'),
      activeAttemptId: optionalString(row.active_attempt_id, 'attempt id'),
      leaseExpiresAt: optionalDate(row.lease_expires_at, 'lease expiration'),
      completedAt: optionalDate(row.completed_at, 'completion time'),
      lastError: optionalString(row.last_error, 'outbox error'),
    }
  }

  function get(jobId: string) {
    const row = context.database
      .prepare('SELECT * FROM specter_reaction_outbox WHERE id = ?')
      .get(jobId) as Record<string, unknown> | undefined
    return row ? toJob(row) : undefined
  }

  function update(sql: string, values: readonly SQLInputValue[], cause: Error) {
    const result = context.database.prepare(sql).run(...values)
    if (result.changes !== 1) throw cause
  }

  return {
    enqueue: (input: EnqueueReactionInput<TPayload>) =>
      context.transaction(() => {
        const existing = context.database
          .prepare(
            'SELECT * FROM specter_reaction_outbox WHERE idempotency_key = ?',
          )
          .get(input.idempotencyKey) as Record<string, unknown> | undefined
        if (existing) return { job: toJob(existing), created: false }
        const payload = JSON.stringify(input.payload)
        if (payload === undefined) {
          throw new Error('Reaction outbox payload must be JSON-serializable')
        }
        context.database
          .prepare(
            `INSERT INTO specter_reaction_outbox (
              id, idempotency_key, payload, status, requested_at,
              available_at, attempt_count
            ) VALUES (?, ?, ?, 'pending', ?, ?, 0)`,
          )
          .run(
            input.id,
            input.idempotencyKey,
            payload,
            input.requestedAt.toISOString(),
            input.availableAt.toISOString(),
          )
        const job = get(input.id)
        if (!job) throw new Error('Failed to read inserted outbox job')
        return { job, created: true }
      }),

    claimNext: (now, leaseExpiresAt) =>
      context.transaction(() => {
        const row = context.database
          .prepare(
            `SELECT * FROM specter_reaction_outbox
              WHERE status = 'pending' AND available_at <= ?
              ORDER BY available_at ASC, requested_at ASC, id ASC LIMIT 1`,
          )
          .get(now.toISOString()) as Record<string, unknown> | undefined
        if (!row) return undefined
        const job = toJob(row)
        const attemptCount = job.attemptCount + 1
        const attemptId = `${job.id}:attempt:${attemptCount}`
        update(
          `UPDATE specter_reaction_outbox SET
            status = 'running', attempt_count = ?, active_attempt_id = ?,
            lease_expires_at = ?, completed_at = NULL
            WHERE id = ? AND status = 'pending'`,
          [attemptCount, attemptId, leaseExpiresAt.toISOString(), job.id],
          new Error(`Outbox job claimed concurrently: ${job.id}`),
        )
        return {
          ...job,
          status: 'running',
          attemptCount,
          activeAttemptId: attemptId,
          leaseExpiresAt,
          completedAt: undefined,
        } satisfies ReactionOutboxClaim<TPayload>
      }),

    complete: (jobId, attemptId, completedAt) =>
      context.transaction(() =>
        update(
          `UPDATE specter_reaction_outbox SET status = 'completed',
            active_attempt_id = NULL, lease_expires_at = NULL,
            completed_at = ?, last_error = NULL
            WHERE id = ? AND status = 'running' AND active_attempt_id = ?`,
          [completedAt.toISOString(), jobId, attemptId],
          new ReactionOutboxLeaseLostError(attemptId),
        ),
      ),

    reschedule: (jobId, attemptId, availableAt, error) =>
      context.transaction(() =>
        update(
          `UPDATE specter_reaction_outbox SET status = 'pending',
            available_at = ?, active_attempt_id = NULL,
            lease_expires_at = NULL, last_error = ?
            WHERE id = ? AND status = 'running' AND active_attempt_id = ?`,
          [availableAt.toISOString(), error, jobId, attemptId],
          new ReactionOutboxLeaseLostError(attemptId),
        ),
      ),

    deadLetter: (jobId, attemptId, failedAt, error) =>
      context.transaction(() =>
        update(
          `UPDATE specter_reaction_outbox SET status = 'dead-letter',
            active_attempt_id = NULL, lease_expires_at = NULL,
            completed_at = ?, last_error = ?
            WHERE id = ? AND status = 'running' AND active_attempt_id = ?`,
          [failedAt.toISOString(), error, jobId, attemptId],
          new ReactionOutboxLeaseLostError(attemptId),
        ),
      ),

    requeueExpired: (now) =>
      context.run(() =>
        Number(
          context.database
            .prepare(
              `UPDATE specter_reaction_outbox SET status = 'pending',
                available_at = ?, active_attempt_id = NULL,
                lease_expires_at = NULL,
                last_error = 'Reaction attempt lease expired'
                WHERE status = 'running' AND lease_expires_at <= ?`,
            )
            .run(now.toISOString(), now.toISOString()).changes,
        ),
      ),

    nextWorkAt: () =>
      context.run(() => {
        const row = context.database
          .prepare(
            `SELECT MIN(wake_at) AS wake_at FROM (
              SELECT available_at AS wake_at FROM specter_reaction_outbox
                WHERE status = 'pending'
              UNION ALL
              SELECT lease_expires_at AS wake_at FROM specter_reaction_outbox
                WHERE status = 'running' AND lease_expires_at IS NOT NULL
            )`,
          )
          .get() as Record<string, unknown>
        return row.wake_at === null
          ? undefined
          : date(row.wake_at, 'next outbox work time')
      }),

    get: (jobId) => context.run(() => get(jobId)),

    list: (status) =>
      context.run(() => {
        const statement = context.database.prepare(
          `SELECT * FROM specter_reaction_outbox
            ${status ? 'WHERE status = ?' : ''}
            ORDER BY requested_at ASC, id ASC`,
        )
        const rows = status ? statement.all(status) : statement.all()
        return rows.map((row) => toJob(row as Record<string, unknown>))
      }),

    retryDeadLetter: (jobId, availableAt) =>
      context.transaction(() =>
        update(
          `UPDATE specter_reaction_outbox SET status = 'pending',
            available_at = ?, completed_at = NULL, last_error = NULL
            WHERE id = ? AND status = 'dead-letter'`,
          [availableAt.toISOString(), jobId],
          new Error(`Outbox job is not dead-lettered: ${jobId}`),
        ),
      ),
  }
}
