import { ReactionScheduler } from '@specter-ts/core'
import {
  reactionSchedulerConformance,
  testEventLogService,
  testSliceStoreService,
} from '@specter-ts/core/testing'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { openNodeSqlite } from './database'
import {
  createNodeSqliteEventLogService,
  prepareNodeSqliteEventLog,
} from './event-log'
import {
  createNodeSqliteReactionSchedulerLayer,
  prepareNodeSqliteReactionScheduler,
} from './reaction-scheduler'
import { createSpecterNodeSqliteLayer, SpecterNodeSqlite } from './runtime'
import {
  createNodeSqliteSliceStoreService,
  prepareNodeSqliteSliceStore,
} from './slice-store'

testEventLogService('node:sqlite', () => {
  const context = openNodeSqlite({ filename: ':memory:' })
  prepareNodeSqliteEventLog(context)
  return createNodeSqliteEventLogService(context, {
    eventId: (() => {
      let sequence = 0
      return () => `event-${++sequence}`
    })(),
    now: () => new Date(0),
  })
})

testSliceStoreService('node:sqlite', {
  createService: () => {
    const context = openNodeSqlite({ filename: ':memory:' })
    prepareNodeSqliteSliceStore(context)
    return createNodeSqliteSliceStoreService(context, () => ({ value: 0 }))
  },
  write: async (state, value: number) => {
    state.value = value
  },
  read: async (state) => state.value,
  value: 42,
})

it('node:sqlite scheduler conforms', async () => {
  const context = openNodeSqlite({ filename: ':memory:' })
  prepareNodeSqliteReactionScheduler(context)
  await Effect.runPromise(
    Effect.scoped(
      Effect.provide(
        Effect.flatMap(ReactionScheduler, (service) =>
          reactionSchedulerConformance(Effect.succeed(service)),
        ),
        createNodeSqliteReactionSchedulerLayer(context, () => new Date(0)),
      ),
    ),
  )
  context.database.close()
})

describe('node:sqlite Effect runtime', () => {
  it('acquires and closes DatabaseSync with Scope', async () => {
    let context: ReturnType<typeof openNodeSqlite> | undefined
    await Effect.runPromise(
      Effect.scoped(
        Effect.provide(
          Effect.map(SpecterNodeSqlite, (runtime) => {
            context = runtime.context
          }),
          createSpecterNodeSqliteLayer({ filename: ':memory:' }),
        ),
      ),
    )
    expect(() => context?.database.exec('SELECT 1')).toThrow()
  })

  it('retries unacknowledged durable delivery with stable id', async () => {
    const context = openNodeSqlite({ filename: ':memory:' })
    prepareNodeSqliteReactionScheduler(context)
    const ids: string[] = []
    const first = Effect.gen(function* () {
      const scheduler = yield* ReactionScheduler
      const completion = yield* scheduler.schedule(9, (delivery) =>
        Effect.gen(function* () {
          ids.push(delivery.deliveryId)
          return yield* Effect.fail('first attempt fails')
        }),
      )
      yield* Effect.result(completion)
    })
    await Effect.runPromise(
      Effect.scoped(
        Effect.provide(first, createNodeSqliteReactionSchedulerLayer(context)),
      ),
    )
    const second = Effect.flatMap(ReactionScheduler, (scheduler) =>
      scheduler.recover((delivery) =>
        Effect.sync(() => {
          ids.push(delivery.deliveryId)
        }),
      ),
    )
    await Effect.runPromise(
      Effect.scoped(
        Effect.provide(second, createNodeSqliteReactionSchedulerLayer(context)),
      ),
    )
    expect(ids).toEqual(['reaction-through-9', 'reaction-through-9'])
    context.database.close()
  })
})
