import type { Client } from '@libsql/client'
import {
  ReactionScheduler,
  ReactionSchedulerFailure,
  type ReactionScheduleContext,
  type ReactionSchedulerService,
} from '@specter-ts/core'
import { Effect, Layer } from 'effect'

import {
  createSqliteDatabaseContext,
  requireNumber,
  requireString,
  type SqliteDatabaseContext,
} from './database'

export type SqliteReactionSchedulerOptions = {
  readonly context?: SqliteDatabaseContext
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

export async function prepareSqliteReactionScheduler(client: Client) {
  await client.execute('PRAGMA busy_timeout = 5000')
  await client.batch(
    [
      `CREATE TABLE IF NOT EXISTS specter_reaction_scheduler (
        through_order INTEGER PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed')),
        scheduled_at TEXT NOT NULL,
        available_at TEXT NOT NULL,
        lease_expires_at TEXT,
        claim_token TEXT,
        last_error TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS specter_reaction_scheduler_pending_idx
        ON specter_reaction_scheduler(status, available_at, through_order)`,
    ],
    'write',
  )
}

export function createSqliteReactionSchedulerService(
  client: Client,
  options: SqliteReactionSchedulerOptions = {},
): ReactionSchedulerService {
  const context = options.context ?? createSqliteDatabaseContext(client)
  const now = options.now ?? (() => new Date())
  const leaseMs = options.leaseMs ?? 5 * 60_000
  const pollIntervalMs = options.pollIntervalMs ?? 100
  const retryIntervalMs = options.retryIntervalMs ?? 100

  function attempt<A>(
    operation: 'schedule' | 'run',
    run: (connection: import('./database').SqliteConnection) => Promise<A>,
  ): Effect.Effect<A, ReactionSchedulerFailure> {
    return context.use((connection) =>
      Effect.tryPromise({
        try: () => run(connection),
        catch: (cause) => new ReactionSchedulerFailure(operation, cause),
      }),
    )
  }

  function decodeDate(value: unknown, field: string) {
    const decoded = new Date(requireString(value, field))
    if (Number.isNaN(decoded.getTime()))
      throw new Error(`Expected SQLite ${field} to be ISO-8601`)
    return decoded
  }

  function decodeRow(row: Record<string, unknown>): SchedulerRow {
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
    return attempt('schedule', async (connection) => {
      const requestedAt = now().toISOString()
      await connection.execute({
        sql: `INSERT INTO specter_reaction_scheduler (
          through_order, status, scheduled_at, available_at
        ) VALUES (?, 'pending', ?, ?)
        ON CONFLICT (through_order) DO UPDATE SET
          status = 'pending', available_at = excluded.available_at,
          lease_expires_at = NULL, claim_token = NULL, last_error = NULL
        WHERE specter_reaction_scheduler.status = 'completed'`,
        args: [throughOrder, requestedAt, requestedAt],
      })
    })
  }

  function claim(
    throughOrder: number,
  ): Effect.Effect<Claim, ReactionSchedulerFailure> {
    return attempt('run', async (connection) => {
      const claimTime = now()
      const token = globalThis.crypto.randomUUID()
      const leaseExpiresAt = new Date(claimTime.getTime() + leaseMs)
      const claimed = await connection.execute({
        sql: `UPDATE specter_reaction_scheduler
          SET status = 'running', lease_expires_at = ?, claim_token = ?
          WHERE through_order = ? AND status != 'completed'
            AND ((status = 'pending' AND available_at <= ?)
              OR (status = 'running'
                AND (lease_expires_at IS NULL OR lease_expires_at <= ?)))`,
        args: [
          leaseExpiresAt.toISOString(),
          token,
          throughOrder,
          claimTime.toISOString(),
          claimTime.toISOString(),
        ],
      })
      if (claimed.rowsAffected === 1) {
        const row = await connection.execute({
          sql: `SELECT scheduled_at FROM specter_reaction_scheduler
            WHERE through_order = ?`,
          args: [throughOrder],
        })
        return {
          type: 'claimed',
          token,
          context: {
            throughOrder,
            scheduledAt: decodeDate(
              row.rows[0]?.scheduled_at,
              'scheduler scheduled time',
            ).toISOString(),
          },
        }
      }
      const current = await connection.execute({
        sql: `SELECT through_order, status, scheduled_at, available_at,
          lease_expires_at FROM specter_reaction_scheduler
          WHERE through_order = ?`,
        args: [throughOrder],
      })
      if (!current.rows[0])
        throw new Error('Failed to read Reaction scheduler job')
      const row = decodeRow(current.rows[0] as Record<string, unknown>)
      if (row.status === 'completed') return { type: 'completed' }
      return {
        type: 'waiting',
        wakeAt:
          row.status === 'running' && row.leaseExpiresAt
            ? row.leaseExpiresAt
            : row.availableAt,
      }
    })
  }

  function complete(throughOrder: number, token: string) {
    return attempt('run', async (connection) => {
      const result = await connection.execute({
        sql: `UPDATE specter_reaction_scheduler
          SET status = 'completed', lease_expires_at = NULL,
            claim_token = NULL, last_error = NULL
          WHERE through_order = ? AND status = 'running' AND claim_token = ?`,
        args: [throughOrder, token],
      })
      if (result.rowsAffected !== 1)
        throw new Error(`Reaction scheduler lease was lost: ${throughOrder}`)
    })
  }

  function reschedule(throughOrder: number, token: string, cause: unknown) {
    return attempt('run', async (connection) => {
      const availableAt = new Date(now().getTime() + retryIntervalMs)
      const result = await connection.execute({
        sql: `UPDATE specter_reaction_scheduler
          SET status = 'pending', available_at = ?, lease_expires_at = NULL,
            claim_token = NULL, last_error = ?
          WHERE through_order = ? AND status = 'running' AND claim_token = ?`,
        args: [availableAt.toISOString(), String(cause), throughOrder, token],
      })
      if (result.rowsAffected !== 1)
        throw new Error(`Reaction scheduler lease was lost: ${throughOrder}`)
      return availableAt
    })
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
    return attempt('run', async (connection) => {
      const currentTime = now().toISOString()
      const result = await connection.execute({
        sql: `SELECT through_order FROM specter_reaction_scheduler
          WHERE (status = 'pending' AND available_at <= ?)
            OR (status = 'running'
              AND (lease_expires_at IS NULL OR lease_expires_at <= ?))
          ORDER BY through_order ASC LIMIT 1`,
        args: [currentTime, currentTime],
      })
      const value = result.rows[0]?.through_order
      return value === undefined
        ? undefined
        : requireNumber(value, 'scheduler through order')
    })
  }

  function waitFor(throughOrder: number) {
    return Effect.gen(function* () {
      for (;;) {
        const status = yield* attempt('run', async (connection) => {
          const result = await connection.execute({
            sql: `SELECT status FROM specter_reaction_scheduler
              WHERE through_order = ?`,
            args: [throughOrder],
          })
          if (!result.rows[0])
            throw new Error(
              `Unknown Reaction scheduler boundary: ${throughOrder}`,
            )
          return requireString(result.rows[0].status, 'scheduler status')
        })
        if (status === 'completed') return
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

export function createSqliteReactionSchedulerLayer(
  client: Client,
  options: SqliteReactionSchedulerOptions = {},
): Layer.Layer<never> {
  return Layer.succeed(
    ReactionScheduler,
    createSqliteReactionSchedulerService(client, options),
  )
}
