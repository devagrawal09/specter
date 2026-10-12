import type {
  SliceSnapshot,
  SliceSnapshotStore,
  SliceStoreService,
  SliceStoreTag,
} from '@specter-ts/core'
import { Duration, Effect, Layer, Schedule, type Scope } from 'effect'

import {
  createMemorySliceStoreService,
  type MemorySliceStoreOptions,
  type MemorySliceStoreService,
} from './slice-store'

/**
 * Memory Slice Stores that start each Slice from its snapshot, and are
 * snapshotted again. Each Slice folds in memory, as in any memory Store; the
 * snapshots only spare a later process the fold of the log up to them.
 */
export type SnapshotSliceStores = {
  /** A memory Store service whose Slices start from their snapshots. */
  readonly service: <TWriteState, TReadState = Readonly<TWriteState>>(
    createState: () => TWriteState,
    options?: Omit<MemorySliceStoreOptions<TWriteState, TReadState>, 'initial'>,
  ) => MemorySliceStoreService<TWriteState, TReadState>
  /** Provides a Store Tag with such a service. */
  readonly layer: <TIdentifier, TWriteState, TReadState>(
    tag: SliceStoreTag<
      TIdentifier,
      SliceStoreService<TReadState, TWriteState, unknown>
    >,
    createState: () => TWriteState,
    options?: Omit<MemorySliceStoreOptions<TWriteState, TReadState>, 'initial'>,
  ) => Layer.Layer<TIdentifier>
  /**
   * The current State of every Slice in use, each at its own cursor and
   * version. A Slice that has not moved since its last snapshot is left out.
   */
  readonly snapshot: () => readonly SliceSnapshot[]
}

/**
 * Memory Slice Stores seeded from snapshots. A Slice starts from its
 * snapshot when the snapshot's version is the Slice's (`SliceStoreSlice
 * .version`), and catches up after its cursor; a Slice without one, or whose
 * snapshot is of another version, starts empty and folds the log, keeping
 * the cursor its name reached (a Reaction does not deliver again what it
 * delivered under its old version). Snapshots are taken per Slice, each at
 * its own cursor, so they need no coordination with each other or with
 * appends.
 */
export function createSnapshotSliceStores(
  snapshots: Iterable<SliceSnapshot> = [],
): SnapshotSliceStores {
  const saved = new Map(
    [...snapshots].map((snapshot) => [snapshot.slice, snapshot]),
  )
  const services: Array<{
    readonly slices: Set<string>
    readonly service: MemorySliceStoreService<unknown, unknown>
  }> = []

  const service = <TWriteState, TReadState = Readonly<TWriteState>>(
    createState: () => TWriteState,
    options: Omit<
      MemorySliceStoreOptions<TWriteState, TReadState>,
      'initial'
    > = {},
  ) => {
    const slices = new Set<string>()
    const created = createMemorySliceStoreService(createState, {
      ...options,
      initial: (slice) => {
        slices.add(slice.name)
        const snapshot = saved.get(slice.name)
        if (!snapshot) return undefined
        return {
          ...(snapshot.version === slice.version
            ? {
                folded: {
                  state: snapshot.state as TWriteState,
                  cursor: snapshot.cursor,
                },
              }
            : {}),
          reached: Math.max(snapshot.reached ?? 0, snapshot.cursor),
        }
      },
    })
    services.push({
      slices,
      service: created as MemorySliceStoreService<unknown, unknown>,
    })
    return created
  }

  return {
    service,
    layer: <TIdentifier, TWriteState, TReadState>(
      tag: SliceStoreTag<
        TIdentifier,
        SliceStoreService<TReadState, TWriteState, unknown>
      >,
      createState: () => TWriteState,
      options?: Omit<
        MemorySliceStoreOptions<TWriteState, TReadState>,
        'initial'
      >,
    ) =>
      Layer.sync(tag as never, () =>
        service(createState, options),
      ) as Layer.Layer<TIdentifier>,
    snapshot: () =>
      services.flatMap(({ slices, service }) =>
        [...slices].flatMap((slice) => {
          const current = service.inspect(slice)
          if (current === undefined) return []
          const last = saved.get(slice)
          if (
            last?.version === current.version &&
            last.cursor === current.lastAppliedOrder &&
            Math.max(last.reached ?? 0, last.cursor) === current.reached
          )
            return []
          const taken: SliceSnapshot = {
            slice,
            version: current.version,
            state: current.state,
            cursor: current.lastAppliedOrder,
            reached: current.reached,
          }
          saved.set(slice, taken)
          return [taken]
        }),
      ),
  }
}

export type PersistSliceSnapshotsOptions = {
  /** How often the Slices that moved are saved; one minute by default. */
  readonly interval?: Duration.Input
  /**
   * The names of the Slices the runtime serves (`Object.keys(config.slices)`).
   * When given, the snapshots of every other Slice are removed from the store
   * as it loads: a Slice the app no longer registers leaves nothing behind.
   */
  readonly slices?: readonly string[]
}

/**
 * Memory Slice Stores that start from a snapshot store's snapshots and save
 * theirs back every `interval` and once the scope closes. Make the runtime
 * after this, in the same scope: the last save then runs after the runtime
 * has closed, with every Slice where it stopped. A save that fails is logged,
 * and its snapshots are saved with the next one; a lost snapshot only makes
 * its Slice fold the log again. With `slices`, the snapshots of Slices the
 * runtime does not serve are removed first.
 */
export function persistSliceSnapshots(
  store: SliceSnapshotStore,
  options: PersistSliceSnapshotsOptions = {},
): Effect.Effect<SnapshotSliceStores, unknown, Scope.Scope> {
  return Effect.gen(function* () {
    const loaded = yield* store.load
    const served = options.slices && new Set(options.slices)
    const gone = served
      ? loaded
          .filter((snapshot) => !served.has(snapshot.slice))
          .map((snapshot) => snapshot.slice)
      : []
    if (gone.length > 0) yield* store.remove(gone)
    const stores = createSnapshotSliceStores(
      served ? loaded.filter((snapshot) => served.has(snapshot.slice)) : loaded,
    )
    const interval = Duration.fromInputUnsafe(
      options.interval ?? Duration.minutes(1),
    )
    // Snapshots taken and not yet saved, by Slice: a later one replaces it.
    const unsaved = new Map<string, SliceSnapshot>()
    const save = Effect.suspend(() => {
      for (const snapshot of stores.snapshot())
        unsaved.set(snapshot.slice, snapshot)
      const taken = [...unsaved.values()]
      return taken.length === 0
        ? Effect.void
        : store.save(taken).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                for (const snapshot of taken) {
                  if (unsaved.get(snapshot.slice) === snapshot)
                    unsaved.delete(snapshot.slice)
                }
              }),
            ),
          )
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning('Failed to save Specter Slice snapshots', cause),
      ),
    )
    yield* Effect.addFinalizer(() => save)
    yield* save.pipe(
      Effect.repeat(Schedule.spaced(interval)),
      Effect.delay(interval),
      Effect.forkScoped,
    )
    return stores
  })
}

/**
 * Snapshots kept in this process, for tests and in-process hosts: a
 * `SliceSnapshotStore` that holds one snapshot per Slice.
 */
export function createMemorySliceSnapshotStore(): SliceSnapshotStore & {
  readonly snapshots: () => readonly SliceSnapshot[]
} {
  const saved = new Map<string, SliceSnapshot>()
  const copy = (snapshot: SliceSnapshot): SliceSnapshot => ({
    ...snapshot,
    state: structuredClone(snapshot.state),
  })
  return {
    load: Effect.sync(() => [...saved.values()].map(copy)),
    save: (snapshots) =>
      Effect.sync(() => {
        for (const snapshot of snapshots) {
          const current = saved.get(snapshot.slice)
          if (
            current?.version === snapshot.version &&
            current.cursor > snapshot.cursor
          )
            continue
          saved.set(snapshot.slice, copy(snapshot))
        }
      }),
    remove: (slices) =>
      Effect.sync(() => {
        for (const slice of slices) saved.delete(slice)
      }),
    snapshots: () => [...saved.values()].map(copy),
  }
}
