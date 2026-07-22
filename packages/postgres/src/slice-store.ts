import type { SliceStoreService, SliceStoreTag } from '@specter-ts/core'
import { Effect, Layer } from 'effect'

import {
  createPostgresDatabaseContext,
  type PostgresDatabaseFailure,
  postgresJson,
  postgresNumber,
  type PostgresConnection,
  type PostgresDatabaseContext,
  type PostgresDatabaseOptions,
  type PostgresPool,
} from './database'

export class PostgresSliceStoreFailure extends Error {
  readonly _tag = 'PostgresSliceStoreFailure' as const

  constructor(
    readonly operation: 'lock' | 'read' | 'write' | 'publish-cursor',
    readonly cause: unknown,
  ) {
    super(`Postgres Slice Store ${operation} failed.`, { cause })
    this.name = 'PostgresSliceStoreFailure'
  }
}

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
): SliceStoreService<
  TReadState,
  TWriteState,
  PostgresSliceStoreFailure | PostgresDatabaseFailure
> {
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
    const result = await connection.query(
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
    if (result.rowCount !== 1) {
      throw new Error(`Stale Slice cursor publication for ${sliceName}`)
    }
  }

  function attempt<A>(
    operation: PostgresSliceStoreFailure['operation'],
    run: () => Promise<A>,
  ) {
    return Effect.tryPromise({
      try: run,
      catch: (cause) => new PostgresSliceStoreFailure(operation, cause),
    })
  }

  return {
    read: (sliceName, run) =>
      context.use((connection) =>
        Effect.gen(function* () {
          const current = yield* attempt('read', () =>
            load(connection, sliceName),
          )
          return yield* run(read(current.state), current.cursor)
        }),
      ),
    transaction: (sliceName, run) =>
      context.transaction((connection) =>
        Effect.gen(function* () {
          yield* attempt('lock', () =>
            connection.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
              `specter-slice:${sliceName}`,
            ]),
          )
          const working = yield* attempt('read', () =>
            load(connection, sliceName),
          )
          let published = false
          const result = yield* run(
            working.state,
            () => read(working.state),
            working.cursor,
            (order) => {
              if (!Number.isSafeInteger(order) || order < working.cursor) {
                return Effect.fail(
                  new PostgresSliceStoreFailure(
                    'publish-cursor',
                    `Cursor must advance from ${working.cursor}; received ${order}`,
                  ),
                )
              }
              working.cursor = order
              published = true
              return Effect.void
            },
          )
          if (published) {
            yield* attempt('write', () => save(connection, sliceName, working))
          }
          return result
        }),
      ),
  }
}

export function createPostgresSliceStoreLayer<
  TIdentifier,
  TWriteState,
  TReadState,
>(
  tag: SliceStoreTag<
    TIdentifier,
    SliceStoreService<
      TReadState,
      TWriteState,
      PostgresSliceStoreFailure | PostgresDatabaseFailure
    >
  >,
  pool: PostgresPool,
  createState: () => TWriteState,
  options: PostgresSliceStoreOptions<TWriteState, TReadState> = {},
): Layer.Layer<TIdentifier> {
  return Layer.succeed(
    tag,
    createPostgresSliceStoreService(pool, createState, options),
  )
}
