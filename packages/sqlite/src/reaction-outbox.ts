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
  requireNumber,
  requireString,
  type SqliteDatabaseContext,
  type SqliteDatabaseFailure,
  type SqliteRow,
} from './database'
import type { SqliteMigration } from './migrations'

export type SqliteReactionOutboxCodec<TPayload> = {
  readonly encode: (payload: TPayload) => string
  readonly decode: (payload: string) => TPayload
}

export type SqliteReactionOutboxOptions<TPayload = unknown> = {
  /**
   * The queue this Store's jobs belong to. A worker claims every job of its
   * Store, so give each wrapped Plugin its own queue. Defaults to `default`.
   */
  readonly queue?: string
  readonly codec?: SqliteReactionOutboxCodec<TPayload>
}

export type SqliteReactionOutboxStore<TPayload> =
  ReactionOutboxStore<TPayload> &
    Required<
      Pick<
        ReactionOutboxStore<TPayload>,
        'concurrencyKeys' | 'renewLease' | 'subscribe'
      >
    > & {
      readonly queue: string
      /**
       * Returns the queue's running jobs to pending, available at `now` with
       * a fresh attempt count, and with `deadLetters` its dead-lettered jobs
       * too; answers how many. For a process starting as the queue's only
       * worker: the attempts an earlier process left running died with it,
       * so they need not wait out their leases. Never call it while another
       * process may be running the queue's jobs.
       */
      readonly release: (
        now: Date,
        options?: { readonly deadLetters?: boolean },
      ) => Effect.Effect<number, SqliteDatabaseFailure>
      /**
       * Deletes the queue's jobs that completed no later than `before`, and
       * answers how many. A delivery whose job is gone, if it is ever
       * delivered again, is enqueued again and runs again.
       */
      readonly prune: (
        before: Date,
      ) => Effect.Effect<number, SqliteDatabaseFailure>
    }

/**
 * The Reaction outbox table, as versioned migrations: `migrateSpecterSqlite`
 * applies them, or a host runs them in its own migrations.
 */
export const sqliteReactionOutboxMigrations: readonly SqliteMigration[] = [
  {
    store: 'reaction-outbox',
    version: 1,
    description: 'Outbox jobs by queue',
    statements: [
      `CREATE TABLE specter_reaction_outbox (
        queue TEXT NOT NULL,
        id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        concurrency_key TEXT,
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
        last_error TEXT,
        PRIMARY KEY (queue, id),
        UNIQUE (queue, idempotency_key)
      )`,
      `CREATE INDEX specter_reaction_outbox_pending_idx
        ON specter_reaction_outbox(queue, status, available_at, requested_at, id)`,
    ],
  },
]

/** No other job of its queue with its concurrency key is running. */
const unblocked = (alias: string) => `(${alias}.concurrency_key IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM specter_reaction_outbox busy
    WHERE busy.queue = ${alias}.queue
      AND busy.status = 'running'
      AND busy.concurrency_key = ${alias}.concurrency_key
  ))`

/**
 * A Reaction outbox Store in the database. Every operation is one statement,
 * atomic in SQLite and visible to workers in other processes once its
 * transaction commits; an enqueue inside a Slice Store or Event Log
 * transaction commits with it. It keeps each job's concurrency key, renews
 * leases, and wakes this process's workers when it makes work claimable.
 */
export function createSqliteReactionOutboxStore<TPayload>(
  context: SqliteDatabaseContext,
  options: SqliteReactionOutboxOptions<TPayload> = {},
): SqliteReactionOutboxStore<TPayload> {
  const queue = options.queue ?? 'default'
  const codec: SqliteReactionOutboxCodec<TPayload> = options.codec ?? {
    encode(payload) {
      const encoded = JSON.stringify(payload)
      if (encoded === undefined) {
        throw new Error('Reaction outbox payload must be JSON-serializable')
      }
      return encoded
    },
    decode: JSON.parse,
  }
  const listeners = new Set<() => void>()

  function notify() {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        // A wake-up is a hint; the job is already stored.
      }
    }
  }

  function toDate(value: unknown, field: string) {
    const date = new Date(requireString(value, field))
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Expected SQLite ${field} to be an ISO-8601 timestamp`)
    }
    return date
  }

  function toJob(row: SqliteRow): ReactionOutboxJob<TPayload> {
    const optional = <A>(
      value: unknown,
      field: string,
      read: (value: unknown, field: string) => A,
    ) =>
      value === null || value === undefined ? undefined : read(value, field)
    const concurrencyKey = optional(
      row.concurrency_key,
      'outbox concurrency key',
      requireString,
    )
    return {
      id: requireString(row.id, 'outbox job id'),
      idempotencyKey: requireString(
        row.idempotency_key,
        'outbox idempotency key',
      ),
      ...(concurrencyKey === undefined ? {} : { concurrencyKey }),
      payload: codec.decode(requireString(row.payload, 'outbox payload')),
      status: requireString(
        row.status,
        'outbox status',
      ) as ReactionOutboxStatus,
      requestedAt: toDate(row.requested_at, 'outbox requested time'),
      availableAt: toDate(row.available_at, 'outbox available time'),
      attemptCount: requireNumber(row.attempt_count, 'outbox attempt count'),
      activeAttemptId: optional(
        row.active_attempt_id,
        'outbox attempt id',
        requireString,
      ),
      leaseExpiresAt: optional(
        row.lease_expires_at,
        'outbox lease expiration',
        toDate,
      ),
      completedAt: optional(row.completed_at, 'outbox completion time', toDate),
      lastError: optional(row.last_error, 'outbox error', requireString),
    }
  }

  const jobs = (rows: readonly SqliteRow[]) => Effect.try(() => rows.map(toJob))

  /** Settles the active attempt, or fails as the worker expects when it is no longer active. */
  function settle(
    jobId: string,
    attemptId: string,
    set: string,
    args: readonly (string | null)[],
  ) {
    return context
      .execute(
        `UPDATE specter_reaction_outbox
          SET ${set}, active_attempt_id = NULL, lease_expires_at = NULL
          WHERE queue = ? AND id = ? AND status = 'running'
            AND active_attempt_id = ?
          RETURNING id`,
        [...args, queue, jobId, attemptId],
      )
      .pipe(
        Effect.flatMap((rows) =>
          rows.length === 1
            ? Effect.void
            : Effect.fail(new ReactionOutboxLeaseLostError(attemptId)),
        ),
      )
  }

  return {
    queue,
    concurrencyKeys: true,

    enqueue(input: EnqueueReactionInput<TPayload>) {
      return Effect.gen(function* () {
        const payload = yield* Effect.try(() => codec.encode(input.payload))
        const inserted = yield* context.execute(
          `INSERT INTO specter_reaction_outbox (
              queue, id, idempotency_key, concurrency_key, payload, status,
              requested_at, available_at, attempt_count
            ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, 0)
            ON CONFLICT (queue, idempotency_key) DO NOTHING
            RETURNING *`,
          [
            queue,
            input.id,
            input.idempotencyKey,
            input.concurrencyKey ?? null,
            payload,
            input.requestedAt.toISOString(),
            input.availableAt.toISOString(),
          ],
        )
        const created = inserted.length === 1
        const [row] = created
          ? inserted
          : yield* context.execute(
              `SELECT * FROM specter_reaction_outbox
                WHERE queue = ? AND idempotency_key = ?`,
              [queue, input.idempotencyKey],
            )
        if (!row)
          return yield* Effect.fail(
            new Error(`Failed to enqueue Reaction outbox job: ${input.id}`),
          )
        const [job] = yield* jobs([row])
        if (created) notify()
        return { job, created } as EnqueueReactionResult<TPayload>
      })
    },

    claimNext(now, leaseExpiresAt) {
      return context
        .execute(
          `UPDATE specter_reaction_outbox
            SET status = 'running',
              attempt_count = attempt_count + 1,
              active_attempt_id = id || ':attempt:' || (attempt_count + 1),
              lease_expires_at = ?,
              completed_at = NULL
            WHERE queue = ? AND id = (
              SELECT candidate.id FROM specter_reaction_outbox candidate
              WHERE candidate.queue = ? AND candidate.status = 'pending'
                AND candidate.available_at <= ?
                AND ${unblocked('candidate')}
              ORDER BY candidate.available_at ASC, candidate.requested_at ASC,
                candidate.id ASC
              LIMIT 1
            )
            RETURNING *`,
          [leaseExpiresAt.toISOString(), queue, queue, now.toISOString()],
        )
        .pipe(
          Effect.flatMap(jobs),
          Effect.map(
            ([job]) => job as ReactionOutboxClaim<TPayload> | undefined,
          ),
        )
    },

    complete: (jobId, attemptId, completedAt) =>
      settle(
        jobId,
        attemptId,
        "status = 'completed', completed_at = ?, last_error = NULL",
        [completedAt.toISOString()],
      ),

    reschedule: (jobId, attemptId, availableAt, error) =>
      settle(
        jobId,
        attemptId,
        "status = 'pending', available_at = ?, last_error = ?",
        [availableAt.toISOString(), error],
      ),

    deadLetter: (jobId, attemptId, failedAt, error) =>
      settle(
        jobId,
        attemptId,
        "status = 'dead-letter', completed_at = ?, last_error = ?",
        [failedAt.toISOString(), error],
      ),

    renewLease: (jobId, attemptId, leaseExpiresAt) =>
      context
        .execute(
          `UPDATE specter_reaction_outbox SET lease_expires_at = ?
            WHERE queue = ? AND id = ? AND status = 'running'
              AND active_attempt_id = ?
            RETURNING id`,
          [leaseExpiresAt.toISOString(), queue, jobId, attemptId],
        )
        .pipe(
          Effect.flatMap((rows) =>
            rows.length === 1
              ? Effect.void
              : Effect.fail(new ReactionOutboxLeaseLostError(attemptId)),
          ),
        ),

    requeueExpired: (now) =>
      context
        .execute(
          `UPDATE specter_reaction_outbox
            SET status = 'pending',
              available_at = ?,
              active_attempt_id = NULL,
              lease_expires_at = NULL,
              last_error = 'Reaction attempt lease expired'
            WHERE queue = ? AND status = 'running'
              AND lease_expires_at IS NOT NULL
              AND lease_expires_at <= ?
            RETURNING id`,
          [now.toISOString(), queue, now.toISOString()],
        )
        .pipe(Effect.map((rows) => rows.length)),

    nextWorkAt: () =>
      context
        .execute(
          `SELECT MIN(wake_at) AS wake_at FROM (
            SELECT pending.available_at AS wake_at
              FROM specter_reaction_outbox pending
              WHERE pending.queue = ? AND pending.status = 'pending'
                AND ${unblocked('pending')}
            UNION ALL
            SELECT lease_expires_at AS wake_at
              FROM specter_reaction_outbox
              WHERE queue = ? AND status = 'running'
                AND lease_expires_at IS NOT NULL
          )`,
          [queue, queue],
        )
        .pipe(
          Effect.flatMap(([row]) =>
            Effect.try(() =>
              row?.wake_at === null || row?.wake_at === undefined
                ? undefined
                : toDate(row.wake_at, 'next outbox availability'),
            ),
          ),
        ),

    get: (jobId) =>
      context
        .execute(
          'SELECT * FROM specter_reaction_outbox WHERE queue = ? AND id = ?',
          [queue, jobId],
        )
        .pipe(
          Effect.flatMap(jobs),
          Effect.map(([job]) => job),
        ),

    list: (status?: ReactionOutboxStatus) =>
      context
        .execute(
          `SELECT * FROM specter_reaction_outbox
            WHERE queue = ? ${status ? 'AND status = ?' : ''}
            ORDER BY requested_at ASC, id ASC`,
          status ? [queue, status] : [queue],
        )
        .pipe(Effect.flatMap(jobs)),

    retryDeadLetter: (jobId, availableAt) =>
      context
        .execute(
          `UPDATE specter_reaction_outbox
            SET status = 'pending',
              available_at = ?,
              completed_at = NULL,
              last_error = NULL
            WHERE queue = ? AND id = ? AND status = 'dead-letter'
            RETURNING id`,
          [availableAt.toISOString(), queue, jobId],
        )
        .pipe(
          Effect.flatMap((rows) =>
            rows.length === 1
              ? Effect.sync(notify)
              : Effect.fail(
                  new Error(
                    `Reaction outbox job is not dead-lettered: ${jobId}`,
                  ),
                ),
          ),
        ),

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    release: (now, releaseOptions = {}) =>
      context
        .execute(
          `UPDATE specter_reaction_outbox
            SET status = 'pending',
              available_at = ?,
              attempt_count = 0,
              active_attempt_id = NULL,
              lease_expires_at = NULL,
              completed_at = NULL
            WHERE queue = ? AND status IN (${
              releaseOptions.deadLetters
                ? "'running', 'dead-letter'"
                : "'running'"
            })
            RETURNING id`,
          [now.toISOString(), queue],
        )
        .pipe(
          Effect.map((rows) => rows.length),
          Effect.tap((released) =>
            Effect.sync(() => {
              if (released > 0) notify()
            }),
          ),
        ),

    prune: (before) =>
      context
        .execute(
          `DELETE FROM specter_reaction_outbox
            WHERE queue = ? AND status = 'completed' AND completed_at <= ?
            RETURNING id`,
          [queue, before.toISOString()],
        )
        .pipe(Effect.map((rows) => rows.length)),
  }
}
