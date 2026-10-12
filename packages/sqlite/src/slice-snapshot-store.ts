import type { SliceSnapshot, SliceSnapshotStore } from '@specter-ts/core'
import { Effect } from 'effect'

import {
  executeAll,
  requireNumber,
  requireString,
  type SqliteDatabaseContext,
} from './database'

export type SqliteSliceSnapshotCodec = {
  encode(state: unknown): string
  decode(state: string): unknown
}

export type SqliteSliceSnapshotStoreOptions = {
  readonly codec?: SqliteSliceSnapshotCodec
  readonly now?: () => Date
}

const jsonCodec: SqliteSliceSnapshotCodec = {
  encode(state) {
    const encoded = JSON.stringify(state)
    if (encoded === undefined) {
      throw new Error('SQLite Slice snapshot State must be JSON-serializable')
    }
    return encoded
  },
  decode: JSON.parse,
}

/** The statements that create the Slice snapshot table. */
export const sqliteSliceSnapshotSchema: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS specter_slice_snapshots (
    slice_name TEXT PRIMARY KEY,
    version TEXT NOT NULL,
    state_json TEXT NOT NULL,
    cursor INTEGER NOT NULL,
    saved_at TEXT NOT NULL
  )`,
]

export function prepareSqliteSliceSnapshotStore(
  context: SqliteDatabaseContext,
) {
  return executeAll(context, sqliteSliceSnapshotSchema)
}

/**
 * Slice snapshots in the database, one row per Slice with the version of the
 * Slice that folded it. A save writes every snapshot in one transaction and
 * never moves a Slice of the same version back; a snapshot of another
 * version replaces the row whatever its cursor.
 */
export function createSqliteSliceSnapshotStore(
  context: SqliteDatabaseContext,
  options: SqliteSliceSnapshotStoreOptions = {},
): SliceSnapshotStore {
  const codec = options.codec ?? jsonCodec
  const now = options.now ?? (() => new Date())
  return {
    load: context
      .execute(
        `SELECT slice_name, version, state_json, cursor
          FROM specter_slice_snapshots`,
      )
      .pipe(
        Effect.flatMap((rows) =>
          Effect.try(() =>
            rows.map(
              (row): SliceSnapshot => ({
                slice: requireString(row.slice_name, 'snapshot Slice name'),
                version: requireString(row.version, 'snapshot version'),
                state: codec.decode(
                  requireString(row.state_json, 'snapshot State'),
                ),
                cursor: requireNumber(row.cursor, 'snapshot cursor'),
              }),
            ),
          ),
        ),
      ),
    save: (snapshots) =>
      context.transaction(() =>
        Effect.forEach(
          snapshots,
          (snapshot) =>
            Effect.try(() => codec.encode(snapshot.state)).pipe(
              Effect.flatMap((state) =>
                context.execute(
                  `INSERT INTO specter_slice_snapshots (
                      slice_name, version, state_json, cursor, saved_at
                    ) VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(slice_name) DO UPDATE SET
                      version = excluded.version,
                      state_json = excluded.state_json,
                      cursor = excluded.cursor,
                      saved_at = excluded.saved_at
                    WHERE specter_slice_snapshots.version <> excluded.version
                      OR specter_slice_snapshots.cursor < excluded.cursor`,
                  [
                    snapshot.slice,
                    snapshot.version,
                    state,
                    snapshot.cursor,
                    now().toISOString(),
                  ],
                ),
              ),
            ),
          { discard: true },
        ),
      ),
  }
}
