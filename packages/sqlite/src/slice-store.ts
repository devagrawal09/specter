import type {
  SliceStoreService,
  SliceStoreSlice,
  SliceStoreTag,
} from '@specter-ts/core'
import { Effect, Layer } from 'effect'

import {
  executeAll,
  requireNumber,
  requireString,
  type SqliteDatabaseContext,
  type SqliteDatabaseFailure,
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

/** The statements that create the JSON Slice Store's table. */
export const sqliteSliceStoreSchema: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS specter_slice_states (
    slice_name TEXT PRIMARY KEY,
    version TEXT NOT NULL,
    state_json TEXT NOT NULL,
    last_applied_order INTEGER NOT NULL,
    reached INTEGER NOT NULL DEFAULT 0
  )`,
]

export function prepareSqliteSliceStore(context: SqliteDatabaseContext) {
  return executeAll(context, sqliteSliceStoreSchema)
}

/**
 * A Slice Store that keeps each Slice's State as JSON beside its cursor and
 * the Slice's version, and writes both in the database's transaction. State
 * kept under another version of the Slice is not read: the Slice starts
 * empty and folds the log, and its first commit replaces the row, which keeps
 * the highest cursor the Slice reached under any version (`reached`).
 */
export function createSqliteSliceStoreService<
  TWriteState,
  TReadState = Readonly<TWriteState>,
>(
  context: SqliteDatabaseContext,
  createState: () => TWriteState,
  options: SqliteSliceStoreOptions<TWriteState, TReadState> = {},
): SliceStoreService<
  TReadState,
  TWriteState,
  SqliteSliceStoreFailure | SqliteDatabaseFailure
> {
  const codec = options.codec ?? jsonCodec<TWriteState>()
  const read =
    options.read ?? ((state: TWriteState) => state as unknown as TReadState)

  function load(slice: SliceStoreSlice) {
    return context
      .execute(
        `SELECT version, state_json, last_applied_order, reached
          FROM specter_slice_states
          WHERE slice_name = ?`,
        [slice.name],
      )
      .pipe(
        Effect.flatMap(([row]) =>
          Effect.try({
            try: () => {
              if (!row) return { state: createState(), cursor: 0, reached: 0 }
              const cursor = requireNumber(
                row.last_applied_order,
                'Slice cursor',
              )
              const reached = Math.max(
                cursor,
                requireNumber(row.reached, 'Slice reached cursor'),
              )
              // State of another version is never read.
              return requireString(row.version, 'Slice version') ===
                slice.version
                ? {
                    state: codec.decode(
                      requireString(row.state_json, 'Slice State'),
                    ),
                    cursor,
                    reached,
                  }
                : { state: createState(), cursor: 0, reached }
            },
            catch: (cause) => new SqliteSliceStoreFailure('read', cause),
          }),
        ),
      )
  }

  function save(
    slice: SliceStoreSlice,
    entry: { state: TWriteState; cursor: number; reached: number },
  ) {
    return Effect.try({
      try: () => codec.encode(entry.state),
      catch: (cause) => new SqliteSliceStoreFailure('write', cause),
    }).pipe(
      Effect.flatMap((state) =>
        // A State of another version is replaced whatever its cursor.
        context.execute(
          `INSERT INTO specter_slice_states (
              slice_name, version, state_json, last_applied_order, reached
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(slice_name) DO UPDATE SET
              version = excluded.version,
              state_json = excluded.state_json,
              last_applied_order = excluded.last_applied_order,
              reached = MAX(
                specter_slice_states.reached,
                specter_slice_states.last_applied_order,
                excluded.reached
              )
            WHERE specter_slice_states.version <> excluded.version
              OR specter_slice_states.last_applied_order <= excluded.last_applied_order`,
          [
            slice.name,
            slice.version,
            state,
            entry.cursor,
            Math.max(entry.reached, entry.cursor),
          ],
        ),
      ),
    )
  }

  return {
    read: (slice, run) =>
      Effect.flatMap(load(slice), (entry) =>
        run(read(entry.state), entry.cursor, entry.reached),
      ),
    transaction: (slice, run) =>
      context.transaction(() =>
        Effect.gen(function* () {
          const entry = yield* load(slice)
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
          if (published) yield* save(slice, entry)
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
  context: SqliteDatabaseContext,
  createState: () => TWriteState,
  options: SqliteSliceStoreOptions<TWriteState, TReadState> = {},
): Layer.Layer<TIdentifier> {
  return Layer.succeed(
    tag,
    createSqliteSliceStoreService(context, createState, options),
  )
}
