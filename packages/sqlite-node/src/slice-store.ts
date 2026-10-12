import type {
  SliceStoreService,
  SliceStoreSlice,
  SliceStoreTag,
} from '@specter-ts/core'
import { Effect, Layer } from 'effect'

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
    version TEXT NOT NULL,
    state_json TEXT NOT NULL,
    last_applied_order INTEGER NOT NULL
  )`)
}

export function createNodeSqliteSliceStoreService<
  TWriteState,
  TReadState = Readonly<TWriteState>,
>(
  context: NodeSqliteContext,
  createState: () => TWriteState,
  options: NodeSqliteSliceStoreOptions<TWriteState, TReadState> = {},
): SliceStoreService<TReadState, TWriteState, unknown> {
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

  // State kept under another version of the Slice is not read: the Slice
  // starts empty and folds the log.
  function load(slice: SliceStoreSlice) {
    const row = context.database
      .prepare(
        `SELECT state_json, last_applied_order FROM specter_slice_states
          WHERE slice_name = ? AND version = ?`,
      )
      .get(slice.name, slice.version) as Record<string, unknown> | undefined
    return row
      ? {
          state: decode(requireString(row.state_json, 'Slice State')),
          cursor: requireNumber(row.last_applied_order, 'Slice cursor'),
        }
      : { state: createState(), cursor: 0 }
  }

  function save(
    slice: SliceStoreSlice,
    entry: { state: TWriteState; cursor: number },
  ) {
    // A State of another version is replaced whatever its cursor.
    context.database
      .prepare(
        `INSERT INTO specter_slice_states (
          slice_name, version, state_json, last_applied_order
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(slice_name) DO UPDATE SET
          version = excluded.version,
          state_json = excluded.state_json,
          last_applied_order = excluded.last_applied_order
        WHERE specter_slice_states.version <> excluded.version
          OR specter_slice_states.last_applied_order <= excluded.last_applied_order`,
      )
      .run(slice.name, slice.version, encode(entry.state), entry.cursor)
  }

  return {
    read: (slice, run) =>
      Effect.suspend(() => {
        const current = context.run(() => load(slice))
        return run(read(current.state), current.cursor)
      }),
    transaction: (slice, run) =>
      context.transactionEffect(
        Effect.gen(function* () {
          const working = load(slice)
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
          if (published) save(slice, working)
          return result
        }),
      ),
  }
}

export function createNodeSqliteSliceStoreLayer<
  TIdentifier,
  TWriteState,
  TReadState,
>(
  tag: SliceStoreTag<
    TIdentifier,
    SliceStoreService<TReadState, TWriteState, unknown>
  >,
  context: NodeSqliteContext,
  createState: () => TWriteState,
  options: NodeSqliteSliceStoreOptions<TWriteState, TReadState> = {},
): Layer.Layer<TIdentifier> {
  return Layer.sync(tag as never, () =>
    createNodeSqliteSliceStoreService(context, createState, options),
  ) as Layer.Layer<TIdentifier>
}
