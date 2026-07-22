import type { Client } from '@libsql/client'
import type { SliceStoreService, SliceStoreTag } from '@specter-ts/core'
import { Effect, Layer } from 'effect'

import {
  createSqliteDatabaseContext,
  requireNumber,
  requireString,
  type SqliteDatabaseFailure,
  type SqliteConnection,
  type SqliteDatabaseContext,
} from './database'

export class SqliteSliceStoreFailure extends Error {
  readonly _tag = 'SqliteSliceStoreFailure' as const

  constructor(
    readonly operation: 'read' | 'write' | 'publish-cursor',
    readonly cause: unknown,
  ) {
    super(`SQLite Slice Store ${operation} failed.`, { cause })
    this.name = 'SqliteSliceStoreFailure'
  }
}

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
): SliceStoreService<
  TReadState,
  TWriteState,
  SqliteSliceStoreFailure | SqliteDatabaseFailure
> {
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

  function attempt<A>(
    operation: SqliteSliceStoreFailure['operation'],
    run: () => Promise<A>,
  ) {
    return Effect.tryPromise({
      try: run,
      catch: (cause) => new SqliteSliceStoreFailure(operation, cause),
    })
  }

  return {
    read: (sliceName, run) =>
      context.use((connection) =>
        Effect.gen(function* () {
          const entry = yield* attempt('read', () =>
            load(connection, sliceName),
          )
          return yield* run(read(entry.state), entry.cursor)
        }),
      ),
    transaction: (sliceName, run) =>
      context.transaction((connection) =>
        Effect.gen(function* () {
          const entry = yield* attempt('read', () =>
            load(connection, sliceName),
          )
          let published = false
          const result = yield* run(
            entry.state,
            () => read(entry.state),
            entry.cursor,
            (order) => {
              if (!Number.isSafeInteger(order) || order < entry.cursor) {
                return Effect.fail(
                  new SqliteSliceStoreFailure(
                    'publish-cursor',
                    `Cursor must advance from ${entry.cursor}; received ${order}`,
                  ),
                )
              }
              entry.cursor = order
              published = true
              return Effect.void
            },
          )
          if (published) {
            yield* attempt('write', () => save(connection, sliceName, entry))
          }
          return result
        }),
      ),
  }
}

export function createSqliteSliceStoreLayer<
  TIdentifier,
  TWriteState,
  TReadState,
>(
  tag: SliceStoreTag<
    TIdentifier,
    SliceStoreService<
      TReadState,
      TWriteState,
      SqliteSliceStoreFailure | SqliteDatabaseFailure
    >
  >,
  client: Client,
  createState: () => TWriteState,
  options: SqliteSliceStoreOptions<TWriteState, TReadState> = {},
): Layer.Layer<TIdentifier> {
  return Layer.succeed(
    tag,
    createSqliteSliceStoreService(client, createState, options),
  )
}
