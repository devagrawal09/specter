import type { SliceSnapshot, SliceSnapshotStore } from '@specter-ts/core'
import { Effect, Exit, Scope } from 'effect'
import { describe, expect, it } from 'vitest'

import type { MemorySliceStoreService } from './slice-store'
import {
  createMemorySliceSnapshotStore,
  createSnapshotSliceStores,
  persistSliceSnapshots,
} from './snapshots'

type Count = { count: number }

const countQuery = { name: 'countQuery', version: 'sha256:count/1' }
const listQuery = { name: 'listQuery', version: 'sha256:list/1' }

const increment = (
  service: MemorySliceStoreService<Count, Readonly<Count>>,
  slice: typeof countQuery,
  to: number,
) =>
  Effect.runPromise(
    service.transaction(slice, (write, _read, _cursor, publish) =>
      Effect.gen(function* () {
        write.count += 1
        yield* publish(to)
      }),
    ),
  )

describe('memory Slice Stores from snapshots', () => {
  it('starts a Slice from a snapshot of its version, and folds one of another version from the log', async () => {
    const stores = createSnapshotSliceStores([
      {
        slice: 'countQuery',
        version: countQuery.version,
        state: { count: 7 },
        cursor: 12,
      },
      {
        slice: 'listQuery',
        version: 'sha256:list/0',
        state: { count: 99 },
        cursor: 40,
      },
    ])
    const service = stores.service(() => ({ count: 0 }))
    const start = (slice: typeof countQuery) =>
      Effect.runPromise(
        service.read(slice, (state, cursor) =>
          Effect.succeed({ state, cursor }),
        ),
      )
    expect(await start(countQuery)).toEqual({ state: { count: 7 }, cursor: 12 })
    expect(await start(listQuery)).toEqual({ state: { count: 0 }, cursor: 0 })
  })

  it('snapshots each Slice that moved, at its own cursor and version', async () => {
    const stores = createSnapshotSliceStores([
      {
        slice: 'countQuery',
        version: countQuery.version,
        state: { count: 7 },
        cursor: 12,
      },
    ])
    const service = stores.service(() => ({ count: 0 }))
    await Effect.runPromise(service.read(countQuery, () => Effect.void))
    await increment(service, listQuery, 3)
    expect(stores.snapshot()).toEqual([
      {
        slice: 'listQuery',
        version: listQuery.version,
        state: { count: 1 },
        cursor: 3,
      },
    ])
    // Nothing moved since.
    expect(stores.snapshot()).toEqual([])
    await increment(service, countQuery, 13)
    expect(stores.snapshot()).toEqual([
      {
        slice: 'countQuery',
        version: countQuery.version,
        state: { count: 8 },
        cursor: 13,
      },
    ])
  })

  it('saves snapshots when its scope closes and at each interval, and a later process starts from them', async () => {
    const store = createMemorySliceSnapshotStore()
    const scope = Effect.runSync(Scope.make())
    const stores = await Effect.runPromise(
      persistSliceSnapshots(store, { interval: '10 millis' }).pipe(
        Scope.provide(scope),
      ),
    )
    const service = stores.service(() => ({ count: 0 }))
    await increment(service, countQuery, 4)
    await Effect.runPromise(Effect.sleep('50 millis'))
    expect(store.snapshots()).toEqual([
      {
        slice: 'countQuery',
        version: countQuery.version,
        state: { count: 1 },
        cursor: 4,
      },
    ])
    await increment(service, countQuery, 5)
    await Effect.runPromise(Scope.close(scope, Exit.void))
    expect(store.snapshots()).toEqual([
      {
        slice: 'countQuery',
        version: countQuery.version,
        state: { count: 2 },
        cursor: 5,
      },
    ])

    const later = await Effect.runPromise(
      Effect.scoped(
        persistSliceSnapshots(store).pipe(
          Effect.flatMap((stores) =>
            stores
              .service(() => ({ count: 0 }))
              .read(countQuery, (state, cursor) =>
                Effect.succeed({ state, cursor }),
              ),
          ),
        ),
      ),
    )
    expect(later).toEqual({ state: { count: 2 }, cursor: 5 })
  })

  it('saves what a failed save left with the next one', async () => {
    const saved: SliceSnapshot[][] = []
    let failNext = true
    const store: SliceSnapshotStore = {
      load: Effect.succeed([]),
      save: (snapshots) =>
        Effect.suspend(() => {
          if (failNext) {
            failNext = false
            return Effect.fail(new Error('disk full'))
          }
          saved.push([...snapshots])
          return Effect.void
        }),
    }
    const scope = Effect.runSync(Scope.make())
    const stores = await Effect.runPromise(
      persistSliceSnapshots(store, { interval: '10 millis' }).pipe(
        Scope.provide(scope),
      ),
    )
    const service = stores.service(() => ({ count: 0 }))
    await increment(service, countQuery, 4)
    await Effect.runPromise(Effect.sleep('50 millis'))
    await Effect.runPromise(Scope.close(scope, Exit.void))
    expect(saved.flat()).toEqual([
      {
        slice: 'countQuery',
        version: countQuery.version,
        state: { count: 1 },
        cursor: 4,
      },
    ])
  })
})
