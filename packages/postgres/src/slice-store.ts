import type { SliceStore, SliceStoreAdapter } from '@specter-ts/core'

import {
  createPostgresDatabaseContext,
  postgresJson,
  postgresNumber,
  type PostgresConnection,
  type PostgresDatabaseContext,
  type PostgresDatabaseOptions,
  type PostgresPool,
} from './database'

export type PostgresSliceStoreOptions<TWriteState, TReadState> =
  PostgresDatabaseOptions & {
    readonly context?: PostgresDatabaseContext
    readonly read?: (state: TWriteState) => TReadState
  }

export async function preparePostgresSliceStore(pool: PostgresPool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS specter_slice_states (
    slice_name TEXT PRIMARY KEY,
    state_json JSONB NOT NULL,
    last_applied_order BIGINT NOT NULL
  )`)
}

export function createPostgresSliceStore<
  TWriteState,
  TReadState = Readonly<TWriteState>,
>(
  pool: PostgresPool,
  createState: () => TWriteState,
  options: PostgresSliceStoreOptions<TWriteState, TReadState> = {},
): SliceStoreAdapter<TWriteState, TReadState> {
  const context =
    options.context ?? createPostgresDatabaseContext(pool, options)
  const read =
    options.read ?? ((state: TWriteState) => state as unknown as TReadState)

  async function load(connection: PostgresConnection, sliceName: string) {
    const result = await connection.query<{
      state_json: unknown
      last_applied_order: unknown
    }>(
      `SELECT state_json, last_applied_order
       FROM specter_slice_states
       WHERE slice_name = $1`,
      [sliceName],
    )
    const row = result.rows[0]
    if (!row) return { state: createState(), order: 0 }
    return {
      state: postgresJson<TWriteState>(row.state_json, 'Slice State'),
      order: postgresNumber(row.last_applied_order, 'Slice cursor'),
    }
  }

  async function save(
    connection: PostgresConnection,
    sliceName: string,
    entry: { state: TWriteState; order: number },
  ) {
    const encoded = JSON.stringify(entry.state)
    if (encoded === undefined) {
      throw new Error('Postgres Slice State must be JSON-serializable')
    }
    await connection.query(
      `INSERT INTO specter_slice_states (
        slice_name,
        state_json,
        last_applied_order
      ) VALUES ($1, $2::jsonb, $3)
      ON CONFLICT(slice_name) DO UPDATE SET
        state_json = excluded.state_json,
        last_applied_order = excluded.last_applied_order`,
      [sliceName, encoded, entry.order],
    )
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
