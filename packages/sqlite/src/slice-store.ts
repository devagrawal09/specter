import type { Client } from '@libsql/client'
import type { SliceStore, SliceStoreAdapter } from '@specter-ts/core'

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

export function createSqliteSliceStore<
  TWriteState,
  TReadState = Readonly<TWriteState>,
>(
  client: Client,
  createState: () => TWriteState,
  options: SqliteSliceStoreOptions<TWriteState, TReadState> = {},
): SliceStoreAdapter<TWriteState, TReadState> {
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
    if (!row) return { state: createState(), order: 0 }
    return {
      state: codec.decode(requireString(row.state_json, 'Slice State')),
      order: requireNumber(row.last_applied_order, 'Slice cursor'),
    }
  }

  async function save(
    connection: SqliteConnection,
    sliceName: string,
    entry: { state: TWriteState; order: number },
  ) {
    await connection.execute({
      sql: `INSERT INTO specter_slice_states (
          slice_name,
          state_json,
          last_applied_order
        ) VALUES (?, ?, ?)
        ON CONFLICT(slice_name) DO UPDATE SET
          state_json = excluded.state_json,
          last_applied_order = excluded.last_applied_order`,
      args: [sliceName, codec.encode(entry.state), entry.order],
    })
  }

  function toStore(
    entry: {
      state: TWriteState
      order: number
    },
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

  return {
    async get(sliceName) {
      const connection = context.connection()
      const entry = await load(connection, sliceName)
      return toStore(entry, () => save(connection, sliceName, entry))
    },
    transaction(sliceName, run) {
      return context.transaction(async (connection) => {
        const entry = await load(connection, sliceName)
        const result = await run(toStore(entry))
        await save(connection, sliceName, entry)
        return result
      })
    },
  }
}
