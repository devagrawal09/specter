import { Effect } from 'effect'

import {
  createPostgresDatabaseContext,
  postgresNumber,
  postgresString,
  type PostgresPool,
} from './database'

/** A store whose tables Specter's Postgres migrations create and change. */
export type PostgresStore = 'event-log' | 'slice-store' | 'reaction-outbox'

/**
 * One step of a store's schema. A store's migrations are numbered from 1,
 * and each runs once, on a database where the store is at the version
 * before it. A released migration never changes: a release that changes a
 * store's tables adds the next version.
 */
export type PostgresMigration = {
  readonly store: PostgresStore
  readonly version: number
  /** What it changes, in a few words. */
  readonly description: string
  /** Its statements, run in order. */
  readonly statements: readonly string[]
}

export class PostgresMigrationFailure extends Error {
  readonly _tag = 'PostgresMigrationFailure' as const

  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options)
    this.name = 'PostgresMigrationFailure'
  }
}

// Serializes migration runs across processes; Postgres runs DDL in the
// transaction, so a run commits whole or not at all.
const MIGRATION_LOCK_KEY = 8_231_931

/**
 * Brings each store in `migrations` to its last version listed there, in one
 * transaction under an advisory lock, and answers the migrations it applied.
 * It records each one in `specter_migrations (store, version, applied_at)`,
 * so a later run applies only what the database lacks. It refuses a database
 * where a store is at a version the list does not have (a newer Specter
 * migrated it), and a list that skips a version; a statement that fails,
 * such as one creating a table the database already has, fails the run and
 * rolls all of it back.
 *
 * A host with its own migrations runs the statements in them instead, and
 * records in its own journal which versions it ran; `specter_migrations` is
 * then never created.
 */
export function migrateSpecterPostgres(
  pool: PostgresPool,
  migrations: readonly PostgresMigration[],
): Promise<readonly PostgresMigration[]> {
  const context = createPostgresDatabaseContext(pool)
  return Effect.runPromise(
    context.transaction((connection) =>
      Effect.gen(function* () {
        const query = (sql: string, parameters: unknown[] = []) =>
          Effect.tryPromise({
            try: () => connection.query(sql, parameters),
            catch: (cause) =>
              new PostgresMigrationFailure('A migration query failed', {
                cause,
              }),
          })
        yield* query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_KEY])
        yield* query(`CREATE TABLE IF NOT EXISTS specter_migrations (
          store TEXT NOT NULL,
          version INTEGER NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL,
          PRIMARY KEY (store, version)
        )`)
        const recorded = yield* query(
          'SELECT store, version FROM specter_migrations',
        )
        const versions = yield* Effect.try({
          try: () => {
            const versions = new Map<string, number>()
            for (const row of recorded.rows) {
              const store = postgresString(row.store, 'migration store')
              const version = postgresNumber(row.version, 'migration version')
              versions.set(store, Math.max(versions.get(store) ?? 0, version))
            }
            return versions
          },
          catch: (cause) =>
            new PostgresMigrationFailure('Unreadable specter_migrations row', {
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
              new PostgresMigrationFailure(
                `The database has the ${store} store at version ${version}, newer than ${latest}, the last this Specter knows`,
              ),
            )
          }
        }
        const applied: PostgresMigration[] = []
        for (const migration of migrations) {
          const current = versions.get(migration.store) ?? 0
          if (migration.version <= current) continue
          if (migration.version !== current + 1) {
            return yield* Effect.fail(
              new PostgresMigrationFailure(
                `The ${migration.store} store's migration ${migration.version} needs its version ${current + 1} first`,
              ),
            )
          }
          for (const statement of migration.statements) {
            yield* Effect.tryPromise({
              try: () => connection.query(statement),
              catch: (cause) =>
                new PostgresMigrationFailure(
                  `The ${migration.store} store's migration ${migration.version} (${migration.description}) failed`,
                  { cause },
                ),
            })
          }
          yield* query(
            `INSERT INTO specter_migrations (store, version, applied_at)
              VALUES ($1, $2, now())`,
            [migration.store, migration.version],
          )
          versions.set(migration.store, migration.version)
          applied.push(migration)
        }
        return applied
      }),
    ),
  )
}
