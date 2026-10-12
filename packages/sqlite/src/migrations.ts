import { Effect } from 'effect'

import {
  requireNumber,
  requireString,
  type SqliteDatabaseContext,
  type SqliteDatabaseFailure,
} from './database'

/** A store whose tables Specter's SQLite migrations create and change. */
export type SqliteStore =
  | 'event-log'
  | 'slice-store'
  | 'slice-snapshots'
  | 'reaction-outbox'
  | 'reaction-scheduler'

/**
 * One step of a store's schema. A store's migrations are numbered from 1,
 * and each runs once, on a database where the store is at the version
 * before it. A released migration never changes: a release that changes a
 * store's tables adds the next version.
 */
export type SqliteMigration = {
  readonly store: SqliteStore
  readonly version: number
  /** What it changes, in a few words. */
  readonly description: string
  /** Its statements, run in order. */
  readonly statements: readonly string[]
}

export class SqliteMigrationFailure extends Error {
  readonly _tag = 'SqliteMigrationFailure' as const

  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options)
    this.name = 'SqliteMigrationFailure'
  }
}

/**
 * Brings each store in `migrations` to its last version listed there, in one
 * transaction, and answers the migrations it applied. It records each one in
 * `specter_migrations (store, version, applied_at)`, so a later run applies
 * only what the database lacks. It refuses a database where a store is at a
 * version the list does not have (a newer Specter migrated it), and a list
 * that skips a version; a statement that fails, such as one creating a table
 * the database already has, fails the run and rolls all of it back.
 *
 * A host with its own migrations runs the statements in them instead, and
 * records in its own journal which versions it ran; `specter_migrations` is
 * then never created.
 */
export function migrateSpecterSqlite(
  context: SqliteDatabaseContext,
  migrations: readonly SqliteMigration[],
): Effect.Effect<
  readonly SqliteMigration[],
  SqliteDatabaseFailure | SqliteMigrationFailure
> {
  return context.transaction(() =>
    Effect.gen(function* () {
      yield* context.execute(`CREATE TABLE IF NOT EXISTS specter_migrations (
        store TEXT NOT NULL,
        version INTEGER NOT NULL,
        applied_at TEXT NOT NULL,
        PRIMARY KEY (store, version)
      )`)
      const recorded = yield* context.execute(
        'SELECT store, version FROM specter_migrations',
      )
      const versions = yield* Effect.try({
        try: () => {
          const versions = new Map<string, number>()
          for (const row of recorded) {
            const store = requireString(row.store, 'migration store')
            const version = requireNumber(row.version, 'migration version')
            versions.set(store, Math.max(versions.get(store) ?? 0, version))
          }
          return versions
        },
        catch: (cause) =>
          new SqliteMigrationFailure('Unreadable specter_migrations row', {
            cause,
          }),
      })
      for (const [store, version] of versions) {
        const known = migrations.filter(
          (migration) => migration.store === store,
        )
        const latest = Math.max(
          0,
          ...known.map((migration) => migration.version),
        )
        if (known.length > 0 && version > latest) {
          return yield* Effect.fail(
            new SqliteMigrationFailure(
              `The database has the ${store} store at version ${version}, newer than ${latest}, the last this Specter knows`,
            ),
          )
        }
      }
      const applied: SqliteMigration[] = []
      for (const migration of migrations) {
        const current = versions.get(migration.store) ?? 0
        if (migration.version <= current) continue
        if (migration.version !== current + 1) {
          return yield* Effect.fail(
            new SqliteMigrationFailure(
              `The ${migration.store} store's migration ${migration.version} needs its version ${current + 1} first`,
            ),
          )
        }
        yield* Effect.forEach(
          migration.statements,
          (statement) => context.execute(statement),
          { discard: true },
        ).pipe(
          Effect.mapError(
            (cause) =>
              new SqliteMigrationFailure(
                `The ${migration.store} store's migration ${migration.version} (${migration.description}) failed`,
                { cause },
              ),
          ),
        )
        yield* context.execute(
          `INSERT INTO specter_migrations (store, version, applied_at)
            VALUES (?, ?, ?)`,
          [migration.store, migration.version, new Date().toISOString()],
        )
        versions.set(migration.store, migration.version)
        applied.push(migration)
      }
      return applied
    }),
  )
}
