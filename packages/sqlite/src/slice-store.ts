import type { Client } from '@libsql/client'
import type { SliceStoreService, SliceStoreTag } from '@specter-ts/core'
import { Effect, Layer } from 'effect'

import {
  createSqliteDatabaseContext,
  requireNumber,
  requireString,
  type SqliteConnection,
  type SqliteDatabaseContext,
} from './database'

export type SqliteSliceStateCodec<TState> = {
  encode(state: TState): string
  decode(state: string): TState
}

export type SqliteSliceStoreOptions<TWriteState, TReadState> = {
  readonly context?: SqliteDatabaseContext
  readonly codec?: SqliteSliceStateCodec<TWriteState>
  readonly read?: (state: TWriteState) => TReadState
}

const jsonCodec = <TState>(): SqliteSliceStateCodec<TState> => ({
  encode(state) {
    const encoded = JSON.stringify(state)
    if (encoded === undefined) {
      throw new Error('SQLite Slice State must be JSON-serializable')
    }
    return encoded
  },
  decode: JSON.parse,
})

export async function prepareSqliteSliceStore(client: Client) {
  await client.execute(`CREATE TABLE IF NOT EXISTS specter_slice_states (
    slice_name TEXT PRIMARY KEY,
    state_json TEXT NOT NULL,
    last_applied_order INTEGER NOT NULL
  )`)
}

export function createSqliteSliceStoreService<
  TWriteState,
  TReadState = Readonly<TWriteState>,
>(
  client: Client,
  createState: () => TWriteState,
  options: SqliteSliceStoreOptions<TWriteState, TReadState> = {},
): SliceStoreService<TReadState, TWriteState, unknown> {
  const context = options.context ?? createSqliteDatabaseContext(client)
  const codec = options.codec ?? jsonCodec<TWriteState>()
  const read =
    options.read ?? ((state: TWriteState) => state as unknown as TReadState)

  async function load(connection: SqliteConnection, sliceName: string) {
    const result = await connection.execute({
      sql: `SELECT state_json, last_applied_order
        FROM specter_slice_states
        WHERE slice_name = ?`,
      args: [sliceName],
    })
    const row = result.rows[0]
    if (!row) return { state: createState(), cursor: 0 }
    return {
      state: codec.decode(requireString(row.state_json, 'Slice State')),
      cursor: requireNumber(row.last_applied_order, 'Slice cursor'),
    }
  }

  async function save(
    connection: SqliteConnection,
    sliceName: string,
    entry: { state: TWriteState; cursor: number },
  ) {
    await connection.execute({
      sql: `INSERT INTO specter_slice_states (
          slice_name,
          state_json,
          last_applied_order
        ) VALUES (?, ?, ?)
        ON CONFLICT(slice_name) DO UPDATE SET
          state_json = excluded.state_json,
          last_applied_order = excluded.last_applied_order
        WHERE specter_slice_states.last_applied_order <= excluded.last_applied_order`,
      args: [sliceName, codec.encode(entry.state), entry.cursor],
    })
  }

  return {
    read: (sliceName, run) =>
      Effect.tryPromise({
        try: async () => {
          const entry = await load(context.connection(), sliceName)
          return run(read(entry.state), entry.cursor)
        },
        catch: (cause) => cause,
      }),
    transaction: (sliceName, run) =>
      Effect.tryPromise({
        try: () =>
          context.transaction(async (connection) => {
            const entry = await load(connection, sliceName)
            let published = false
            const result = await run(
              entry.state,
              () => read(entry.state),
              entry.cursor,
              async (order) => {
                if (!Number.isInteger(order) || order < entry.cursor) {
                  throw new Error(
                    `Slice cursor must advance monotonically from ${entry.cursor}, received ${order}`,
                  )
                }
                entry.cursor = order
                published = true
              },
            )
            if (published) await save(connection, sliceName, entry)
            return result
          }),
        catch: (cause) => cause,
      }),
  }
}

export function createSqliteSliceStoreLayer<
  TIdentifier,
  TWriteState,
  TReadState,
>(
  tag: SliceStoreTag<
    TIdentifier,
    SliceStoreService<TReadState, TWriteState, unknown>
  >,
  client: Client,
  createState: () => TWriteState,
  options: SqliteSliceStoreOptions<TWriteState, TReadState> = {},
): Layer.Layer<TIdentifier> {
  return Layer.sync(tag as never, () =>
    createSqliteSliceStoreService(client, createState, options),
  ) as Layer.Layer<TIdentifier>
}
