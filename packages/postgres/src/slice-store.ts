import type {
  SliceStoreService,
  SliceStoreSlice,
  SliceStoreTag,
} from '@specter-ts/core'
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
import type { PostgresMigration } from './migrations'

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

/**
 * The JSONB Slice Store's table, as versioned migrations:
 * `migrateSpecterPostgres` applies them, or a host runs them in its own
 * migrations.
 */
export const postgresSliceStoreMigrations: readonly PostgresMigration[] = [
  {
    store: 'slice-store',
    version: 1,
    description: 'Slice State with its cursor, version and reached cursor',
    statements: [
      `CREATE TABLE specter_slice_states (
        slice_name TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        state_json JSONB NOT NULL,
        last_applied_order BIGINT NOT NULL,
        reached BIGINT NOT NULL DEFAULT 0
      )`,
    ],
  },
]

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

  // State kept under another version of the Slice is not read: the Slice
  // starts empty and folds the log, keeping the cursor its name reached.
  async function load(connection: PostgresConnection, slice: SliceStoreSlice) {
    const result = await connection.query<{
      version: unknown
      state_json: unknown
      last_applied_order: unknown
      reached: unknown
    }>(
      `SELECT version, state_json, last_applied_order, reached
       FROM specter_slice_states
       WHERE slice_name = $1`,
      [slice.name],
    )
    const row = result.rows[0]
    if (!row) return { state: createState(), cursor: 0, reached: 0 }
    const cursor = postgresNumber(row.last_applied_order, 'Slice cursor')
    const reached = Math.max(
      cursor,
      postgresNumber(row.reached, 'Slice reached cursor'),
    )
    return row.version === slice.version
      ? {
          state: postgresJson<TWriteState>(row.state_json, 'Slice State'),
          cursor,
          reached,
        }
      : { state: createState(), cursor: 0, reached }
  }

  async function save(
    connection: PostgresConnection,
    slice: SliceStoreSlice,
    entry: { state: TWriteState; cursor: number; reached: number },
  ) {
    const encoded = JSON.stringify(entry.state)
    if (encoded === undefined) {
      throw new Error('Postgres Slice State must be JSON-serializable')
    }
    // A State of another version is replaced whatever its cursor; the cursor
    // its name reached stays.
    const result = await connection.query(
      `INSERT INTO specter_slice_states (
        slice_name,
        version,
        state_json,
        last_applied_order,
        reached
      ) VALUES ($1, $2, $3::jsonb, $4, $5)
      ON CONFLICT(slice_name) DO UPDATE SET
        version = excluded.version,
        state_json = excluded.state_json,
        last_applied_order = excluded.last_applied_order,
        reached = GREATEST(
          specter_slice_states.reached,
          specter_slice_states.last_applied_order,
          excluded.reached
        )
      WHERE specter_slice_states.version <> excluded.version
        OR specter_slice_states.last_applied_order <= excluded.last_applied_order`,
      [
        slice.name,
        slice.version,
        encoded,
        entry.cursor,
        Math.max(entry.reached, entry.cursor),
      ],
    )
    if (result.rowCount !== 1) {
      throw new Error(`Stale Slice cursor publication for ${slice.name}`)
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
    read: (slice, run) =>
      context.use((connection) =>
        Effect.gen(function* () {
          const current = yield* attempt('read', () => load(connection, slice))
          return yield* run(
            read(current.state),
            current.cursor,
            current.reached,
          )
        }),
      ),
    transaction: (slice, run) =>
      context.transaction((connection) =>
        Effect.gen(function* () {
          yield* attempt('lock', () =>
            connection.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
              `specter-slice:${slice.name}`,
            ]),
          )
          const working = yield* attempt('read', () => load(connection, slice))
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
            yield* attempt('write', () => save(connection, slice, working))
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
