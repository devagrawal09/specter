import type {
  SliceStoreService,
  SliceStoreSlice,
  SliceStoreTag,
} from '@specter-ts/core'
import { Effect, Layer, Semaphore } from 'effect'

type SliceEntry<TState> = {
  state: TState
  cursor: number
  readonly version: string
}

export type MemorySliceStoreOptions<TWriteState, TReadState> = {
  readonly clone?: (state: TWriteState) => TWriteState
  readonly read?: (state: TWriteState) => TReadState
  /**
   * A Slice's state and cursor to start from instead of empty state at the
   * log's start, such as a snapshot a host saved from `inspect`, for the
   * Slice's name and version. The Slice catches up from the cursor. Return
   * nothing for a snapshot of another version.
   */
  readonly initial?: (
    slice: SliceStoreSlice,
  ) => { readonly state: TWriteState; readonly cursor: number } | undefined
}

export type MemorySliceStoreService<TWriteState, TReadState> =
  SliceStoreService<TReadState, TWriteState, unknown> & {
    /**
     * A copy of a Slice's committed State, its cursor and the version of
     * the Slice it was folded for, or undefined before its first use.
     */
    readonly inspect: (sliceName: string) =>
      | {
          readonly state: TWriteState
          readonly lastAppliedOrder: number
          readonly version: string
        }
      | undefined
    readonly reset: (sliceName?: string) => void
  }

/**
 * Creates one app-scoped in-memory Store service. It keeps one State per
 * Slice name; a call for another version of the Slice starts it again from
 * `initial` or empty, so a Slice whose State changed shape folds the log.
 */
export function createMemorySliceStoreService<
  TWriteState,
  TReadState = Readonly<TWriteState>,
>(
  createState: () => TWriteState,
  options: MemorySliceStoreOptions<TWriteState, TReadState> = {},
): MemorySliceStoreService<TWriteState, TReadState> {
  const clone = options.clone ?? structuredClone
  const read =
    options.read ?? ((state: TWriteState) => state as unknown as TReadState)
  const entries = new Map<string, SliceEntry<TWriteState>>()
  const semaphores = new Map<string, Semaphore.Semaphore>()

  function getEntry(slice: SliceStoreSlice) {
    const current = entries.get(slice.name)
    if (current?.version === slice.version) return current
    const seeded = options.initial?.(slice)
    const created = seeded
      ? { state: seeded.state, cursor: seeded.cursor, version: slice.version }
      : { state: createState(), cursor: 0, version: slice.version }
    entries.set(slice.name, created)
    return created
  }

  function semaphore(sliceName: string) {
    const existing = semaphores.get(sliceName)
    if (existing) return existing
    const created = Semaphore.makeUnsafe(1)
    semaphores.set(sliceName, created)
    return created
  }

  return {
    read: (slice, run) =>
      Effect.suspend(() => {
        const current = getEntry(slice)
        return run(read(current.state), current.cursor)
      }),
    transaction: (slice, run) =>
      Effect.suspend(() =>
        semaphore(slice.name).withPermit(
          Effect.gen(function* () {
            const current = getEntry(slice)
            const working: SliceEntry<TWriteState> = {
              state: clone(current.state),
              cursor: current.cursor,
              version: current.version,
            }
            let published = false
            const result = yield* run(
              working.state,
              () => read(working.state),
              working.cursor,
              (order) =>
                Effect.sync(() => {
                  if (!Number.isSafeInteger(order) || order < working.cursor) {
                    throw new Error(
                      `Slice cursor must advance monotonically from ${working.cursor}, received ${order}`,
                    )
                  }
                  working.cursor = order
                  published = true
                }),
            )
            if (
              published &&
              entries.get(slice.name) === current &&
              working.cursor >= current.cursor
            ) {
              entries.set(slice.name, working)
            }
            return result
          }),
        ),
      ),
    inspect(sliceName) {
      const current = entries.get(sliceName)
      return current
        ? {
            state: clone(current.state),
            lastAppliedOrder: current.cursor,
            version: current.version,
          }
        : undefined
    },
    reset(sliceName) {
      if (sliceName) entries.delete(sliceName)
      else entries.clear()
    },
  }
}

/** Provides a Store Tag with fresh state for each Layer scope. */
export function createMemorySliceStoreLayer<
  TIdentifier,
  TWriteState,
  TReadState,
>(
  tag: SliceStoreTag<
    TIdentifier,
    SliceStoreService<TReadState, TWriteState, unknown>
  >,
  createState: () => TWriteState,
  options: MemorySliceStoreOptions<TWriteState, TReadState> = {},
): Layer.Layer<TIdentifier> {
  return Layer.sync(tag as never, () =>
    createMemorySliceStoreService(createState, options),
  ) as Layer.Layer<TIdentifier>
}
