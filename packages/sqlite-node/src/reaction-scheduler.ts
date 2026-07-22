import {
  ReactionScheduler,
  ReactionSchedulerFailure,
  type ReactionScheduleContext,
  type ReactionSchedulerService,
} from '@specter-ts/core'
import { Effect, Fiber, Layer, type Scope } from 'effect'

import {
  type NodeSqliteContext,
  requireNumber,
  requireString,
} from './database'

export function prepareNodeSqliteReactionScheduler(context: NodeSqliteContext) {
  context.database.exec(`
    CREATE TABLE IF NOT EXISTS specter_reaction_deliveries (
      id TEXT PRIMARY KEY,
      through_order INTEGER NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed')),
      scheduled_at TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0
    );
  `)
  context.database
    .prepare(
      `UPDATE specter_reaction_deliveries SET status = 'pending'
       WHERE status = 'running'`,
    )
    .run()
}

type Delivery = {
  readonly id: string
  readonly throughOrder: number
  readonly scheduledAt: string
  readonly attemptCount: number
  readonly status: 'pending' | 'running' | 'completed'
}

export function createNodeSqliteReactionSchedulerService(
  context: NodeSqliteContext,
  scope: Scope.Scope,
  now: () => Date = () => new Date(),
  waitIntervalMs = 25,
): ReactionSchedulerService {
  const active = new Map<number, Fiber.Fiber<void, any>>()

  function decode(row: Record<string, unknown>): Delivery {
    return {
      id: requireString(row.id, 'Reaction delivery id'),
      throughOrder: requireNumber(row.through_order, 'Reaction through order'),
      scheduledAt: requireString(row.scheduled_at, 'Reaction scheduled time'),
      attemptCount: requireNumber(row.attempt_count, 'Reaction attempt count'),
      status: requireString(
        row.status,
        'Reaction status',
      ) as Delivery['status'],
    }
  }

  function get(throughOrder: number) {
    const row = context.database
      .prepare(
        `SELECT id, through_order, status, scheduled_at, attempt_count
         FROM specter_reaction_deliveries WHERE through_order = ?`,
      )
      .get(throughOrder) as Record<string, unknown> | undefined
    return row ? decode(row) : undefined
  }

  function ensure(throughOrder: number) {
    const existing = get(throughOrder)
    if (existing) return existing
    const id = `reaction-through-${throughOrder}`
    context.database
      .prepare(
        `INSERT INTO specter_reaction_deliveries (
          id, through_order, status, scheduled_at, attempt_count
        ) VALUES (?, ?, 'pending', ?, 0)`,
      )
      .run(id, throughOrder, now().toISOString())
    const inserted = get(throughOrder)
    if (!inserted) throw new Error('Failed to create Reaction delivery')
    return inserted
  }

  function runDelivery<E>(
    delivery: Delivery,
    execute: (context: ReactionScheduleContext) => Effect.Effect<void, E>,
  ) {
    return Effect.gen(function* () {
      if (delivery.status === 'completed') return
      const attemptNumber = delivery.attemptCount + 1
      yield* context.transactionEffect(
        Effect.sync(() => {
          context.database
            .prepare(
              `UPDATE specter_reaction_deliveries
               SET status = 'running', attempt_count = ? WHERE id = ?`,
            )
            .run(attemptNumber, delivery.id)
        }),
      )
      const result = yield* Effect.result(
        execute({
          throughOrder: delivery.throughOrder,
          scheduledAt: delivery.scheduledAt,
        }),
      )
      if (result._tag === 'Failure') {
        yield* context.transactionEffect(
          Effect.sync(() => {
            context.database
              .prepare(
                `UPDATE specter_reaction_deliveries SET status = 'pending'
                 WHERE id = ?`,
              )
              .run(delivery.id)
          }),
        )
        return yield* Effect.fail(result.failure)
      }
      yield* context.transactionEffect(
        Effect.sync(() => {
          context.database
            .prepare(
              `UPDATE specter_reaction_deliveries SET status = 'completed'
               WHERE id = ?`,
            )
            .run(delivery.id)
        }),
      )
    })
  }

  return {
    bind: ({ execute, reconcile }) =>
      Effect.gen(function* () {
        yield* reconcile

        const pending = yield* Effect.try({
          try: () =>
            context.database
              .prepare(
                `SELECT id, through_order, status, scheduled_at, attempt_count
                 FROM specter_reaction_deliveries
                 WHERE status != 'completed' ORDER BY through_order ASC`,
              )
              .all()
              .map((row) => decode(row as Record<string, unknown>)),
          catch: (cause) => new ReactionSchedulerFailure('reconcile', cause),
        })

        const start = (delivery: Delivery) =>
          Effect.gen(function* () {
            if (
              delivery.status === 'completed' ||
              active.has(delivery.throughOrder)
            )
              return
            const fiber = yield* Effect.forkIn(
              runDelivery(delivery, execute).pipe(
                Effect.ensuring(
                  Effect.sync(() => {
                    active.delete(delivery.throughOrder)
                  }),
                ),
              ),
              scope,
            )
            active.set(delivery.throughOrder, fiber)
          })

        for (const delivery of pending) yield* start(delivery)

        return {
          request: (throughOrder: number) =>
            Effect.gen(function* () {
              const delivery = yield* Effect.try({
                try: () => ensure(throughOrder),
                catch: (cause) =>
                  new ReactionSchedulerFailure('request', cause),
              })
              yield* start(delivery)
            }),
          await: (throughOrder: number) =>
            Effect.gen(function* () {
              for (;;) {
                const delivery = yield* Effect.try({
                  try: () => get(throughOrder),
                  catch: (cause) => new ReactionSchedulerFailure('wait', cause),
                })
                if (!delivery) {
                  return yield* Effect.fail(
                    new ReactionSchedulerFailure(
                      'wait',
                      new Error(`Unknown Reaction delivery: ${throughOrder}`),
                    ),
                  )
                }
                if (delivery.status === 'completed') return
                const fiber = active.get(throughOrder)
                if (fiber) yield* Fiber.join(fiber)
                else yield* Effect.sleep(`${waitIntervalMs} millis`)
              }
            }),
        }
      }),
  }
}

export function createNodeSqliteReactionSchedulerLayer(
  context: NodeSqliteContext,
  now?: () => Date,
): Layer.Layer<never> {
  return Layer.effect(
    ReactionScheduler,
    Effect.gen(function* () {
      const scope = yield* Effect.scope
      return createNodeSqliteReactionSchedulerService(context, scope, now)
    }),
  )
}
