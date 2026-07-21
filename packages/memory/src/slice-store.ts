import type { SliceStoreService, SliceStoreTag } from '@specter-ts/core'
import { Effect, Layer } from 'effect'

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
  const transactionTails = new Map<string, Promise<void>>()

  function getEntry(sliceName: string) {
    const current = entries.get(sliceName)
    if (current) return current
    const created = { state: createState(), cursor: 0 }
    entries.set(sliceName, created)
    return created
  }

  async function serialize<A>(sliceName: string, run: () => Promise<A>) {
    const previous = transactionTails.get(sliceName) ?? Promise.resolve()
    let release = () => {}
    const tail = new Promise<void>((resolve) => {
      release = resolve
    })
    const queued = previous.then(() => tail)
    transactionTails.set(sliceName, queued)
    await previous
    try {
      return await run()
    } finally {
      release()
      if (transactionTails.get(sliceName) === queued) {
        transactionTails.delete(sliceName)
      }
    }
  }

  return {
    read: (sliceName, run) =>
      Effect.tryPromise({
        try: () => {
          const current = getEntry(sliceName)
          return run(read(current.state), current.cursor)
        },
        catch: (cause) => cause,
      }),
    transaction: (sliceName, run) =>
      Effect.tryPromise({
        try: () => serialize(sliceName, async () => {
          const current = getEntry(sliceName)
          const working = {
            state: clone(current.state),
            cursor: current.cursor,
          }
          let published = false
          const result = await run(
            working.state,
            () => read(working.state),
            working.cursor,
            async (order) => {
              if (!Number.isInteger(order) || order < working.cursor) {
                throw new Error(
                  `Slice cursor must advance monotonically from ${working.cursor}, received ${order}`,
                )
              }
              working.cursor = order
              published = true
            },
          )
          if (published && working.cursor >= current.cursor) {
            entries.set(sliceName, working)
          }
          return result
        }),
        catch: (cause) => cause,
      }),
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
