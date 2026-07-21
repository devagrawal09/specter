import type { SliceStore, SliceStoreAdapter } from '@specter-ts/core'

import {
  type NodeSqliteContext,
  requireNumber,
  requireString,
} from './database'

export type NodeSqliteSliceStoreOptions<TWriteState, TReadState> = {
  readonly read?: (state: TWriteState) => TReadState
  readonly encode?: (state: TWriteState) => string
  readonly decode?: (state: string) => TWriteState
}

export function prepareNodeSqliteSliceStore(context: NodeSqliteContext) {
  context.database.exec(`CREATE TABLE IF NOT EXISTS specter_slice_states (
    slice_name TEXT PRIMARY KEY,
    state_json TEXT NOT NULL,
    last_applied_order INTEGER NOT NULL
  )`)
}

export function createNodeSqliteSliceStore<
  TWriteState,
  TReadState = Readonly<TWriteState>,
>(
  context: NodeSqliteContext,
  createState: () => TWriteState,
  options: NodeSqliteSliceStoreOptions<TWriteState, TReadState> = {},
): SliceStoreAdapter<TWriteState, TReadState> {
  const read =
    options.read ?? ((state: TWriteState) => state as unknown as TReadState)
  const encode =
    options.encode ??
    ((state: TWriteState) => {
      const encoded = JSON.stringify(state)
      if (encoded === undefined) {
        throw new Error('SQLite Slice State must be JSON-serializable')
      }
      return encoded
    })
  const decode =
    options.decode ?? (JSON.parse as (value: string) => TWriteState)

  function load(sliceName: string) {
    const row = context.database
      .prepare(
        `SELECT state_json, last_applied_order FROM specter_slice_states
          WHERE slice_name = ?`,
      )
      .get(sliceName) as Record<string, unknown> | undefined
    return row
      ? {
          state: decode(requireString(row.state_json, 'Slice State')),
          order: requireNumber(row.last_applied_order, 'Slice cursor'),
        }
      : { state: createState(), order: 0 }
  }

  function save(
    sliceName: string,
    entry: { state: TWriteState; order: number },
  ) {
    context.database
      .prepare(
        `INSERT INTO specter_slice_states (
          slice_name, state_json, last_applied_order
        ) VALUES (?, ?, ?)
        ON CONFLICT(slice_name) DO UPDATE SET
          state_json = excluded.state_json,
          last_applied_order = excluded.last_applied_order`,
      )
      .run(sliceName, encode(entry.state), entry.order)
  }

  function toStore(
    sliceName: string,
    entry: { state: TWriteState; order: number },
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
        await context.run(() => save(sliceName, entry))
      },
    }
  }

  return {
    get: (sliceName) => context.run(() => toStore(sliceName, load(sliceName))),
    transaction: (sliceName, run) =>
      context.transaction(async () => {
        const entry = load(sliceName)
        const result = await run(toStore(sliceName, entry))
        save(sliceName, entry)
        return result
      }),
  }
}
