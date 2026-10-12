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
        reached: 12,
      },
      {
        slice: 'listQuery',
        version: 'sha256:list/0',
        state: { count: 99 },
        cursor: 40,
        reached: 40,
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
    // The Slice of another version keeps the cursor its name reached.
    expect(
      await Effect.runPromise(
        service.read(listQuery, (_state, _cursor, reached) =>
          Effect.succeed(reached),
        ),
      ),
    ).toBe(40)
    await increment(service, listQuery, 2)
    expect(stores.snapshot()).toEqual([
      {
        slice: 'listQuery',
        version: listQuery.version,
        state: { count: 1 },
        cursor: 2,
        reached: 40,
      },
    ])
  })

  it('snapshots each Slice that moved, at its own cursor and version', async () => {
    const stores = createSnapshotSliceStores([
      {
        slice: 'countQuery',
        version: countQuery.version,
        state: { count: 7 },
        cursor: 12,
        reached: 12,
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
        reached: 3,
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
        reached: 13,
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
        reached: 4,
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
        reached: 5,
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
      remove: () => Effect.void,
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
        reached: 4,
      },
    ])
  })

  it('removes the snapshots of Slices the runtime does not serve', async () => {
    const store = createMemorySliceSnapshotStore()
    await Effect.runPromise(
      store.save([
        {
          slice: 'countQuery',
          version: countQuery.version,
          state: { count: 3 },
          cursor: 9,
          reached: 9,
        },
        {
          slice: 'retiredQuery',
          version: 'sha256:retired/1',
          state: { count: 1 },
          cursor: 4,
          reached: 4,
        },
      ]),
    )
    const started = await Effect.runPromise(
      Effect.scoped(
        persistSliceSnapshots(store, {
          slices: ['countQuery', 'listQuery'],
        }).pipe(
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
    expect(started).toEqual({ state: { count: 3 }, cursor: 9 })
    expect(store.snapshots().map((snapshot) => snapshot.slice)).toEqual([
      'countQuery',
    ])
  })
})
