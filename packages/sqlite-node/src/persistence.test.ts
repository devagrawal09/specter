import {
  testEventLogAdapter,
  testReactionScheduler,
  testSliceStoreAdapter,
} from '@specter-ts/core/testing'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { openNodeSqlite } from './database'
import {
  createNodeSqliteEventLog,
  prepareNodeSqliteEventLog,
} from './event-log'
import {
  createSpecterNodeSqliteLayer,
  openSpecterNodeSqlite,
  SpecterNodeSqlite,
} from './runtime'
import {
  createNodeSqliteSliceStore,
  prepareNodeSqliteSliceStore,
} from './slice-store'

testEventLogAdapter('node:sqlite', () => {
  const context = openNodeSqlite({ filename: ':memory:' })
  prepareNodeSqliteEventLog(context)
  return createNodeSqliteEventLog(context, {
    eventId: (() => {
      let sequence = 0
      return () => `event-${++sequence}`
    })(),
    now: () => new Date(0),
  })
})

testSliceStoreAdapter('node:sqlite', {
  createAdapter: () => {
    const context = openNodeSqlite({ filename: ':memory:' })
    prepareNodeSqliteSliceStore(context)
    return createNodeSqliteSliceStore(context, () => ({ value: 0 }))
  },
  write: (state, value: number) => {
    state.value = value
  },
  read: (state) => state.value,
  value: 42,
})

testReactionScheduler(
  'node:sqlite',
  () =>
    openSpecterNodeSqlite({
      filename: ':memory:',
      reactions: {
        idFactory: () => 'conformance-pass',
        now: () => new Date(0),
      },
    }).schedule,
)

describe('node:sqlite Effect runtime', () => {
  it('reuses active transaction context for nested adapter work', async () => {
    const context = openNodeSqlite({ filename: ':memory:' })
    context.database.exec('CREATE TABLE nested_test (value INTEGER NOT NULL)')

    await context.transaction(() =>
      context.transaction(() => {
        context.database.exec('INSERT INTO nested_test VALUES (1)')
      }),
    )

    expect(
      context.database
        .prepare('SELECT COUNT(*) AS count FROM nested_test')
        .get(),
    ).toMatchObject({ count: 1 })
    context.database.close()
  })

  it('acquires and closes DatabaseSync with Scope', async () => {
    let runtime: ReturnType<typeof openSpecterNodeSqlite> | undefined
    const program = Effect.gen(function* () {
      runtime = yield* SpecterNodeSqlite
      expect(yield* Effect.promise(runtime.eventLog.currentVersion)).toBe(0)
    })

    await Effect.runPromise(
      Effect.scoped(
        Effect.provide(
          program,
          createSpecterNodeSqliteLayer({ filename: ':memory:' }),
        ),
      ),
    )

    expect(() => runtime?.context.database.exec('SELECT 1')).toThrow()
  })
})
