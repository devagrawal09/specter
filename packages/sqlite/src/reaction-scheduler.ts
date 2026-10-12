import {
  ReactionScheduler,
  ReactionSchedulerFailure,
  type ReactionScheduleContext,
  type ReactionSchedulerService,
} from '@specter-ts/core'
import { Effect, Layer } from 'effect'

import {
  requireNumber,
  requireString,
  type SqliteDatabaseContext,
  type SqliteRow,
  type SqliteValue,
} from './database'
import type { SqliteMigration } from './migrations'

export type SqliteReactionSchedulerOptions = {
  readonly now?: () => Date
  readonly leaseMs?: number
  readonly pollIntervalMs?: number
  readonly retryIntervalMs?: number
}

type SchedulerRow = {
  readonly throughOrder: number
  readonly status: 'pending' | 'running' | 'completed'
  readonly scheduledAt: Date
  readonly availableAt: Date
  readonly leaseExpiresAt?: Date
}

type Claim =
  | { readonly type: 'completed' }
  | { readonly type: 'waiting'; readonly wakeAt: Date }
  | {
      readonly type: 'claimed'
      readonly token: string
      readonly context: ReactionScheduleContext
    }

/**
 * The Reaction scheduler's table, as versioned migrations:
 * `migrateSpecterSqlite` applies them, or a host runs them in its own
 * migrations.
 */
export const sqliteReactionSchedulerMigrations: readonly SqliteMigration[] = [
  {
    store: 'reaction-scheduler',
    version: 1,
    description: 'Scheduled Reaction boundaries',
    statements: [
      `CREATE TABLE specter_reaction_scheduler (
        through_order INTEGER PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed')),
        scheduled_at TEXT NOT NULL,
        available_at TEXT NOT NULL,
        lease_expires_at TEXT,
        claim_token TEXT,
        last_error TEXT
      )`,
      `CREATE INDEX specter_reaction_scheduler_pending_idx
        ON specter_reaction_scheduler(status, available_at, through_order)`,
    ],
  },
]

export function createSqliteReactionSchedulerService(
  context: SqliteDatabaseContext,
  options: SqliteReactionSchedulerOptions = {},
): ReactionSchedulerService {
  const now = options.now ?? (() => new Date())
  const leaseMs = options.leaseMs ?? 5 * 60_000
  const pollIntervalMs = options.pollIntervalMs ?? 100
  const retryIntervalMs = options.retryIntervalMs ?? 100

  /**
   * Runs `run` with a statement runner, failing with a scheduler failure.
   * `run` reads the rows of each statement it awaits.
   */
  function attempt<A>(
    operation: 'schedule' | 'run',
    run: (
      execute: (
        sql: string,
        args?: readonly SqliteValue[],
      ) => Effect.Effect<readonly SqliteRow[], unknown>,
    ) => Effect.Effect<A, unknown>,
  ): Effect.Effect<A, ReactionSchedulerFailure> {
    return Effect.suspend(() =>
      run((sql, args) => context.execute(sql, args)),
    ).pipe(
      // A row that does not decode throws: it fails the operation too.
      Effect.catchDefect((cause) => Effect.fail(cause)),
      Effect.mapError(
        (cause) => new ReactionSchedulerFailure(operation, cause),
      ),
    )
  }

  function decodeDate(value: unknown, field: string) {
    const decoded = new Date(requireString(value, field))
    if (Number.isNaN(decoded.getTime()))
      throw new Error(`Expected SQLite ${field} to be ISO-8601`)
    return decoded
  }

  function decodeRow(row: SqliteRow): SchedulerRow {
    return {
      throughOrder: requireNumber(row.through_order, 'scheduler through order'),
      status: requireString(
        row.status,
        'scheduler status',
      ) as SchedulerRow['status'],
      scheduledAt: decodeDate(row.scheduled_at, 'scheduler scheduled time'),
      availableAt: decodeDate(row.available_at, 'scheduler available time'),
      leaseExpiresAt:
        row.lease_expires_at === null
          ? undefined
          : decodeDate(row.lease_expires_at, 'scheduler lease expiration'),
    }
  }

  function request(throughOrder: number) {
    return attempt('schedule', (execute) => {
      const requestedAt = now().toISOString()
      return execute(
        `INSERT INTO specter_reaction_scheduler (
          through_order, status, scheduled_at, available_at
        ) VALUES (?, 'pending', ?, ?)
        ON CONFLICT (through_order) DO UPDATE SET
          status = 'pending', available_at = excluded.available_at,
          lease_expires_at = NULL, claim_token = NULL, last_error = NULL
        WHERE specter_reaction_scheduler.status = 'completed'`,
        [throughOrder, requestedAt, requestedAt],
      )
    })
  }

  function claim(
    throughOrder: number,
  ): Effect.Effect<Claim, ReactionSchedulerFailure> {
    return attempt('run', (execute) =>
      Effect.gen(function* () {
        const claimTime = now()
        const token = globalThis.crypto.randomUUID()
        const leaseExpiresAt = new Date(claimTime.getTime() + leaseMs)
        const [claimed] = yield* execute(
          `UPDATE specter_reaction_scheduler
            SET status = 'running', lease_expires_at = ?, claim_token = ?
            WHERE through_order = ? AND status != 'completed'
              AND ((status = 'pending' AND available_at <= ?)
                OR (status = 'running'
                  AND (lease_expires_at IS NULL OR lease_expires_at <= ?)))
            RETURNING scheduled_at`,
          [
            leaseExpiresAt.toISOString(),
            token,
            throughOrder,
            claimTime.toISOString(),
            claimTime.toISOString(),
          ],
        )
        if (claimed) {
          return {
            type: 'claimed',
            token,
            context: {
              throughOrder,
              scheduledAt: decodeDate(
                claimed.scheduled_at,
                'scheduler scheduled time',
              ).toISOString(),
            },
          } as const
        }
        const [current] = yield* execute(
          `SELECT through_order, status, scheduled_at, available_at,
            lease_expires_at FROM specter_reaction_scheduler
            WHERE through_order = ?`,
          [throughOrder],
        )
        if (!current)
          return yield* Effect.fail(
            new Error('Failed to read Reaction scheduler job'),
          )
        const row = decodeRow(current)
        if (row.status === 'completed') return { type: 'completed' } as const
        return {
          type: 'waiting',
          wakeAt:
            row.status === 'running' && row.leaseExpiresAt
              ? row.leaseExpiresAt
              : row.availableAt,
        } as const
      }),
    )
  }

  /** Runs an update of the running boundary this claim holds. */
  function settle(
    throughOrder: number,
    token: string,
    set: string,
    args: readonly SqliteValue[],
  ) {
    return attempt('run', (execute) =>
      execute(
        `UPDATE specter_reaction_scheduler
          SET ${set}
          WHERE through_order = ? AND status = 'running' AND claim_token = ?
          RETURNING through_order`,
        [...args, throughOrder, token],
      ).pipe(
        Effect.flatMap((rows) =>
          rows.length === 1
            ? Effect.void
            : Effect.fail(
                new Error(`Reaction scheduler lease was lost: ${throughOrder}`),
              ),
        ),
      ),
    )
  }

  function complete(throughOrder: number, token: string) {
    return settle(
      throughOrder,
      token,
      `status = 'completed', lease_expires_at = NULL,
        claim_token = NULL, last_error = NULL`,
      [],
    )
  }

  function reschedule(throughOrder: number, token: string, cause: unknown) {
    const availableAt = new Date(now().getTime() + retryIntervalMs)
    return settle(
      throughOrder,
      token,
      `status = 'pending', available_at = ?, lease_expires_at = NULL,
        claim_token = NULL, last_error = ?`,
      [availableAt.toISOString(), String(cause)],
    ).pipe(Effect.as(availableAt))
  }

  /**
   * Completes a boundary that can never succeed, keeping the error so waiters
   * fail instead of polling forever. Reaction cursors stay on the failed commit;
   * a later schedule of this boundary (e.g. app restart) retries it.
   */
  function failPermanently(
    throughOrder: number,
    token: string,
    cause: unknown,
  ) {
    return settle(
      throughOrder,
      token,
      `status = 'completed', lease_expires_at = NULL,
        claim_token = NULL, last_error = ?`,
      [describeFailure(cause)],
    )
  }

  function run<E>(
    throughOrder: number,
    execute: (context: ReactionScheduleContext) => Effect.Effect<void, E>,
  ): Effect.Effect<void, E | ReactionSchedulerFailure> {
    return Effect.gen(function* () {
      for (;;) {
        const next = yield* claim(throughOrder)
        if (next.type === 'completed') return
        if (next.type === 'waiting') {
          const delay = Math.max(
            1,
            Math.min(retryIntervalMs, next.wakeAt.getTime() - now().getTime()),
          )
          yield* Effect.sleep(`${delay} millis`)
          continue
        }
        const result = yield* Effect.result(execute(next.context))
        if (result._tag === 'Success') {
          yield* complete(throughOrder, next.token)
          return
        }
        if (isPermanentFailure(result.failure)) {
          yield* failPermanently(throughOrder, next.token, result.failure)
          return yield* Effect.fail(result.failure)
        }
        const availableAt = yield* reschedule(
          throughOrder,
          next.token,
          result.failure,
        )
        const delay = Math.max(1, availableAt.getTime() - now().getTime())
        yield* Effect.sleep(`${delay} millis`)
      }
    })
  }

  function nextRunnableOrder() {
    return attempt('run', (execute) => {
      const currentTime = now().toISOString()
      return execute(
        `SELECT through_order FROM specter_reaction_scheduler
          WHERE (status = 'pending' AND available_at <= ?)
            OR (status = 'running'
              AND (lease_expires_at IS NULL OR lease_expires_at <= ?))
          ORDER BY through_order ASC LIMIT 1`,
        [currentTime, currentTime],
      ).pipe(
        Effect.map(([row]) =>
          row?.through_order === undefined
            ? undefined
            : requireNumber(row.through_order, 'scheduler through order'),
        ),
      )
    })
  }

  function waitFor(throughOrder: number) {
    return Effect.gen(function* () {
      for (;;) {
        const row = yield* attempt('run', (execute) =>
          execute(
            `SELECT status, last_error FROM specter_reaction_scheduler
              WHERE through_order = ?`,
            [throughOrder],
          ).pipe(
            Effect.flatMap(([found]) =>
              found
                ? Effect.succeed({
                    status: requireString(found.status, 'scheduler status'),
                    lastError: found.last_error,
                  })
                : Effect.fail(
                    new Error(
                      `Unknown Reaction scheduler boundary: ${throughOrder}`,
                    ),
                  ),
            ),
          ),
        )
        if (row.status === 'completed') {
          if (typeof row.lastError === 'string') {
            return yield* Effect.fail(
              new ReactionSchedulerFailure('run', new Error(row.lastError)),
            )
          }
          return
        }
        yield* Effect.sleep(`${pollIntervalMs} millis`)
      }
    })
  }

  function worker<E>(
    execute: (context: ReactionScheduleContext) => Effect.Effect<void, E>,
  ) {
    return Effect.forever(
      Effect.gen(function* () {
        const throughOrder = yield* nextRunnableOrder()
        if (throughOrder === undefined) {
          yield* Effect.sleep(`${pollIntervalMs} millis`)
          return
        }
        yield* run(throughOrder, execute)
      }).pipe(Effect.catch(() => Effect.sleep(`${pollIntervalMs} millis`))),
    )
  }

  return {
    bind: ({ execute }) =>
      Effect.gen(function* () {
        yield* Effect.forkScoped(worker(execute))
        return {
          schedule: (throughOrder: number) =>
            request(throughOrder).pipe(Effect.as(waitFor(throughOrder))),
        }
      }),
  }
}

function isPermanentFailure(cause: unknown) {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'permanent' in cause &&
    cause.permanent === true
  )
}

function describeFailure(cause: unknown) {
  if (!(cause instanceof Error)) return String(cause)
  const details =
    'failures' in cause && Array.isArray(cause.failures)
      ? cause.failures.map(
          (failure: { sliceName?: unknown; cause?: unknown }) =>
            `${String(failure.sliceName)}: ${
              failure.cause instanceof Error
                ? failure.cause.message
                : String(failure.cause)
            }`,
        )
      : []
  return [cause.message, ...details].join('\n')
}

export function createSqliteReactionSchedulerLayer(
  context: SqliteDatabaseContext,
  options: SqliteReactionSchedulerOptions = {},
): Layer.Layer<never> {
  return Layer.succeed(
    ReactionScheduler,
    createSqliteReactionSchedulerService(context, options),
  )
}
