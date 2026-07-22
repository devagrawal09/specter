import {
  ReactionScheduler,
  ReactionSchedulerFailure,
  type ReactionDeliveryContext,
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
): ReactionSchedulerService {
  const active = new Map<number, Fiber.Fiber<void, unknown>>()

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
    execute: (context: ReactionDeliveryContext) => Effect.Effect<void, E>,
  ) {
    return Effect.gen(function* () {
      if (delivery.status === 'completed') return
      const attemptNumber = delivery.attemptCount + 1
      context.transaction(() => {
        context.database
          .prepare(
            `UPDATE specter_reaction_deliveries
             SET status = 'running', attempt_count = ? WHERE id = ?`,
          )
          .run(attemptNumber, delivery.id)
      })
      const attemptId = `${delivery.id}:attempt:${attemptNumber}`
      const result = yield* Effect.result(
        execute({
          deliveryId: delivery.id,
          throughOrder: delivery.throughOrder,
          scheduledAt: delivery.scheduledAt,
          attemptId,
          attemptNumber,
        }),
      )
      if (result._tag === 'Failure') {
        context.transaction(() => {
          context.database
            .prepare(
              `UPDATE specter_reaction_deliveries SET status = 'pending'
               WHERE id = ?`,
            )
            .run(delivery.id)
        })
        return yield* Effect.fail(result.failure)
      }
      context.transaction(() => {
        context.database
          .prepare(
            `UPDATE specter_reaction_deliveries SET status = 'completed'
             WHERE id = ?`,
          )
          .run(delivery.id)
      })
    })
  }

  return {
    schedule: (throughOrder, execute) =>
      Effect.gen(function* () {
        const running = active.get(throughOrder)
        if (running) return Fiber.join(running) as Effect.Effect<void, any>
        const delivery = yield* Effect.try({
          try: () => ensure(throughOrder),
          catch: (cause) => new ReactionSchedulerFailure('schedule', cause),
        })
        if (delivery.status === 'completed') return Effect.void
        const fiber = yield* Effect.forkIn(
          runDelivery(delivery, execute).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                active.delete(throughOrder)
              }),
            ),
          ),
          scope,
        )
        active.set(throughOrder, fiber)
        return Fiber.join(fiber)
      }),
    recover: (execute) =>
      Effect.gen(function* () {
        const deliveries = yield* Effect.try({
          try: () =>
            context.database
              .prepare(
                `SELECT id, through_order, status, scheduled_at, attempt_count
                 FROM specter_reaction_deliveries
                 WHERE status != 'completed' ORDER BY through_order ASC`,
              )
              .all()
              .map((row) => decode(row as Record<string, unknown>)),
          catch: (cause) => new ReactionSchedulerFailure('recover', cause),
        })
        for (const delivery of deliveries) {
          yield* runDelivery(delivery, execute)
        }
      }),
  }
}

export function createNodeSqliteReactionSchedulerLayer(
  context: NodeSqliteContext,
  now?: () => Date,
): Layer.Layer<ReactionScheduler> {
  return Layer.effect(
    ReactionScheduler,
    Effect.gen(function* () {
      const scope = yield* Effect.scope
      return createNodeSqliteReactionSchedulerService(context, scope, now)
    }),
  )
}
