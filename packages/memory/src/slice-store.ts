import type { SliceStore, SliceStoreAdapter } from '@specter-ts/core'

type SliceEntry<TState> = {
  state: TState
  order: number
}

export type MemorySliceStoreOptions<TWriteState, TReadState> = {
  readonly clone?: (state: TWriteState) => TWriteState
  readonly read?: (state: TWriteState) => TReadState
}

export type MemorySliceStoreAdapter<TWriteState, TReadState> =
  SliceStoreAdapter<TWriteState, TReadState> & {
    inspect(
      sliceName: string,
    ):
      | { readonly state: TWriteState; readonly lastAppliedOrder: number }
      | undefined
    reset(sliceName?: string): void
  }

export function createMemorySliceStore<
  TWriteState,
  TReadState = Readonly<TWriteState>,
>(
  createState: () => TWriteState,
  options: MemorySliceStoreOptions<TWriteState, TReadState> = {},
): MemorySliceStoreAdapter<TWriteState, TReadState> {
  const clone = options.clone ?? structuredClone
  const read =
    options.read ?? ((state: TWriteState) => state as unknown as TReadState)
  const entries = new Map<string, SliceEntry<TWriteState>>()
  const transactionTails = new Map<string, Promise<void>>()

  function getEntry(sliceName: string) {
    let entry = entries.get(sliceName)
    if (!entry) {
      entry = { state: createState(), order: 0 }
      entries.set(sliceName, entry)
    }
    return entry
  }

  function toStore(
    entry: SliceEntry<TWriteState>,
    commitAtCursor?: () => Promise<void>,
  ): SliceStore<TWriteState, TReadState> {
    return {
      write: entry.state,
      get read() {
        return read(entry.state)
      },
      lastAppliedOrder: async () => entry.order,
      setLastAppliedOrder: async (order) => {
        if (!Number.isInteger(order) || order < entry.order) {
          throw new Error(
            `Slice cursor must advance monotonically from ${entry.order}, received ${order}`,
          )
        }
        entry.order = order
        await commitAtCursor?.()
      },
    }
  }

  async function serialize<T>(sliceName: string, run: () => Promise<T>) {
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
    async get(sliceName) {
      const current = getEntry(sliceName)
      const working: SliceEntry<TWriteState> = {
        state: clone(current.state),
        order: current.order,
      }
      return toStore(working, async () => {
        entries.set(sliceName, working)
      })
    },
    transaction(sliceName, run) {
      return serialize(sliceName, async () => {
        const current = getEntry(sliceName)
        const working: SliceEntry<TWriteState> = {
          state: clone(current.state),
          order: current.order,
        }
        const result = await run(toStore(working))
        entries.set(sliceName, working)
        return result
      })
    },
    inspect(sliceName) {
      const entry = entries.get(sliceName)
      if (!entry) return undefined
      return {
        state: clone(entry.state),
        lastAppliedOrder: entry.order,
      }
    },
    reset(sliceName) {
      if (sliceName) entries.delete(sliceName)
      else entries.clear()
    },
  }
}
