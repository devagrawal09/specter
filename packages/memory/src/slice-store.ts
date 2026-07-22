import type { SliceStoreService, SliceStoreTag } from '@specter-ts/core'
import { Effect, Layer, Semaphore } from 'effect'

type SliceEntry<TState> = {
  state: TState
  cursor: number
}

export type MemorySliceStoreOptions<TWriteState, TReadState> = {
  readonly clone?: (state: TWriteState) => TWriteState
  readonly read?: (state: TWriteState) => TReadState
}

export type MemorySliceStoreService<TWriteState, TReadState> =
  SliceStoreService<TReadState, TWriteState, unknown> & {
    readonly inspect: (
      sliceName: string,
    ) =>
      | { readonly state: TWriteState; readonly lastAppliedOrder: number }
      | undefined
    readonly reset: (sliceName?: string) => void
  }

/** Creates one app-scoped in-memory Store service. */
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

  function getEntry(sliceName: string) {
    const current = entries.get(sliceName)
    if (current) return current
    const created = { state: createState(), cursor: 0 }
    entries.set(sliceName, created)
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
    read: (sliceName, run) =>
      Effect.suspend(() => {
        const current = getEntry(sliceName)
        return run(read(current.state), current.cursor)
      }),
    transaction: (sliceName, run) =>
      Effect.suspend(() =>
        semaphore(sliceName).withPermit(
          Effect.gen(function* () {
            const current = getEntry(sliceName)
            const working: SliceEntry<TWriteState> = {
              state: clone(current.state),
              cursor: current.cursor,
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
            if (published && working.cursor >= current.cursor) {
              entries.set(sliceName, working)
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
