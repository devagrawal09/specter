import { createMemorySliceStoreService } from '@specter-ts/memory'
import { Layer } from 'effect'

import type { ProvideSliceStore } from './app.ts'

// One Slice's state as of its cursor: what a host persists, and what a Slice
// starts from at the next boot instead of folding the log from its start.
export type SliceSnapshot = {
  readonly slice: string
  readonly state: unknown
  readonly cursor: number
}

// Slice Stores kept in memory, as the runtime's own are, that start from the
// host's snapshots and can be snapshotted again. A Slice without a snapshot
// starts empty and folds the log; one with a snapshot catches up after its
// cursor. Snapshots are taken per Slice, each at its own cursor, so they need
// no coordination with each other or with appends.
export const makeSnapshotSliceStores = (snapshots: Iterable<SliceSnapshot>) => {
  const saved = new Map(
    [...snapshots].map((snapshot) => [snapshot.slice, snapshot]),
  )
  const services: Array<{
    readonly slices: Set<string>
    readonly service: ReturnType<typeof createMemorySliceStoreService>
  }> = []
  const provide: ProvideSliceStore = (tag, createState) =>
    Layer.sync(tag as never, () => {
      const slices = new Set<string>()
      const service = createMemorySliceStoreService(createState, {
        initial: (slice) => {
          slices.add(slice)
          const snapshot = saved.get(slice)
          return snapshot === undefined
            ? undefined
            : { state: snapshot.state as never, cursor: snapshot.cursor }
        },
      })
      services.push({
        slices,
        service: service as ReturnType<typeof createMemorySliceStoreService>,
      })
      return service
    }) as never
  // The current state of every Slice in use, each at its own cursor; a Slice
  // that has not moved since its snapshot is left out.
  const snapshot = (): SliceSnapshot[] =>
    services.flatMap(({ slices, service }) =>
      [...slices].flatMap((slice) => {
        const current = service.inspect(slice)
        if (current === undefined) return []
        if (saved.get(slice)?.cursor === current.lastAppliedOrder) return []
        const taken = {
          slice,
          state: current.state,
          cursor: current.lastAppliedOrder,
        }
        saved.set(slice, taken)
        return [taken]
      }),
    )
  return { provide, snapshot }
}
