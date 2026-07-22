import {
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

describe('node:sqlite Effect runtime', () => {
  it('joins nested Event Log appends to Slice Store transactions', async () => {
    const context = openNodeSqlite({ filename: ':memory:' })
    prepareNodeSqliteEventLog(context)
    prepareNodeSqliteSliceStore(context)
    const eventLog = createNodeSqliteEventLogService(context)
    const store = createNodeSqliteSliceStoreService(context, () => ({
      count: 0,
    }))

    await Effect.runPromise(
      Effect.result(
        store.transaction('reaction', (write, _read, _cursor, publish) =>
          Effect.gen(function* () {
            write.count = 1
            yield* eventLog.append([
              { type: 'nested-command-recorded', payload: { value: 1 } },
            ])
            yield* publish(1)
            return yield* Effect.fail('plugin-failed')
          }),
        ),
      ),
    )

    await expect(
      Effect.runPromise(eventLog.query(0, ['nested-command-recorded'])),
    ).resolves.toEqual([])
    await expect(
      Effect.runPromise(
        store.read('reaction', (read, cursor) =>
          Effect.succeed({ count: read.count, cursor }),
        ),
      ),
    ).resolves.toEqual({ count: 0, cursor: 0 })
  })

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
})
