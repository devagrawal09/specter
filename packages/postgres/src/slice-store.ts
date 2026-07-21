import type { SliceStoreService, SliceStoreTag } from '@specter-ts/core'
import { Effect, Layer } from 'effect'

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

export function createPostgresSliceStoreService<
  TWriteState,
  TReadState = Readonly<TWriteState>,
>(
  pool: PostgresPool,
  createState: () => TWriteState,
  options: PostgresSliceStoreOptions<TWriteState, TReadState> = {},
): SliceStoreService<TReadState, TWriteState, unknown> {
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
    if (!row) return { state: createState(), cursor: 0 }
    return {
      state: postgresJson<TWriteState>(row.state_json, 'Slice State'),
      cursor: postgresNumber(row.last_applied_order, 'Slice cursor'),
    }
  }

  async function save(
    connection: PostgresConnection,
    sliceName: string,
    entry: { state: TWriteState; cursor: number },
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
        last_applied_order = excluded.last_applied_order
      WHERE specter_slice_states.last_applied_order <= excluded.last_applied_order`,
      [sliceName, encoded, entry.cursor],
    )
  }

  return {
    read: (sliceName, run) =>
      Effect.tryPromise({
        try: async () => {
          const current = await load(context.connection(), sliceName)
          return run(read(current.state), current.cursor)
        },
        catch: (cause) => cause,
      }),
    transaction: (sliceName, run) =>
      Effect.tryPromise({
        try: () =>
          context.transaction(async (connection) => {
            const working = await load(connection, sliceName)
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
            if (published) await save(connection, sliceName, working)
            return result
          }),
        catch: (cause) => cause,
      }),
  }
}

export function createPostgresSliceStoreLayer<
  TIdentifier,
  TWriteState,
  TReadState,
>(
  tag: SliceStoreTag<
    TIdentifier,
    SliceStoreService<TReadState, TWriteState, unknown>
  >,
  pool: PostgresPool,
  createState: () => TWriteState,
  options: PostgresSliceStoreOptions<TWriteState, TReadState> = {},
): Layer.Layer<TIdentifier> {
  return Layer.sync(tag as never, () =>
    createPostgresSliceStoreService(pool, createState, options),
  ) as Layer.Layer<TIdentifier>
}
