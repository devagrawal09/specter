import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createClient } from '@libsql/client'
import { Effect, Exit } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'

import { createSqliteDatabaseContext } from './database'
import { sqliteEventLogMigrations } from './event-log'
import {
  migrateSpecterSqlite,
  type SqliteMigration,
  SqliteMigrationFailure,
} from './migrations'
import { prepareSpecterSqlite, specterSqliteMigrations } from './persistence'

const clients: ReturnType<typeof createClient>[] = []
const directories: string[] = []

afterEach(() => {
  for (const client of clients.splice(0)) client.close()
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

function database() {
  const directory = mkdtempSync(join(tmpdir(), 'specter-sqlite-migrations-'))
  directories.push(directory)
  const client = createClient({ url: `file:${join(directory, 'specter.db')}` })
  clients.push(client)
  return { client, context: createSqliteDatabaseContext(client) }
}

const names = async (
  client: ReturnType<typeof createClient>,
  type: 'table' | 'index',
) =>
  (
    await client.execute({
      sql: `SELECT name FROM sqlite_master
        WHERE type = ? AND name LIKE 'specter_%' ORDER BY name`,
      args: [type],
    })
  ).rows.map((row) => String(row.name))

const recorded = async (client: ReturnType<typeof createClient>) =>
  (
    await client.execute(
      'SELECT store, version FROM specter_migrations ORDER BY store, version',
    )
  ).rows.map((row) => `${row.store}@${row.version}`)

/** A later release's migration of the Event Log, for these tests only. */
const eventLogVersion2: SqliteMigration = {
  store: 'event-log',
  version: 2,
  description: 'Events by recorded time',
  statements: [
    'CREATE INDEX specter_events_recorded_idx ON specter_events(recorded_at)',
  ],
}

describe('SQLite migrations', () => {
  it('brings every store to its latest version once, and records each migration', async () => {
    const { client, context } = database()
    const applied = await Effect.runPromise(prepareSpecterSqlite(context))
    expect(applied).toEqual(specterSqliteMigrations)
    expect(await names(client, 'table')).toEqual([
      'specter_event_commits',
      'specter_event_keys',
      'specter_event_purges',
      'specter_events',
      'specter_migrations',
      'specter_reaction_outbox',
      'specter_reaction_scheduler',
      'specter_slice_snapshots',
      'specter_slice_states',
    ])
    expect(await recorded(client)).toEqual([
      'event-log@1',
      'reaction-outbox@1',
      'reaction-scheduler@1',
      'slice-snapshots@1',
      'slice-store@1',
    ])
    // A second run, or a second process, finds nothing to do.
    expect(await Effect.runPromise(prepareSpecterSqlite(context))).toEqual([])
  })

  it('applies only the versions a database lacks, and only for the stores listed', async () => {
    const { client, context } = database()
    await Effect.runPromise(
      migrateSpecterSqlite(context, sqliteEventLogMigrations),
    )
    const applied = await Effect.runPromise(
      migrateSpecterSqlite(context, [
        ...sqliteEventLogMigrations,
        eventLogVersion2,
      ]),
    )
    expect(applied).toEqual([eventLogVersion2])
    expect(await recorded(client)).toEqual(['event-log@1', 'event-log@2'])
    expect(await names(client, 'index')).toContain(
      'specter_events_recorded_idx',
    )
    expect(await names(client, 'table')).not.toContain('specter_slice_states')
  })

  it('refuses a database a newer Specter migrated', async () => {
    const { context } = database()
    await Effect.runPromise(
      migrateSpecterSqlite(context, [
        ...sqliteEventLogMigrations,
        eventLogVersion2,
      ]),
    )
    const refused = await Effect.runPromise(
      Effect.flip(migrateSpecterSqlite(context, sqliteEventLogMigrations)),
    )
    expect(refused).toBeInstanceOf(SqliteMigrationFailure)
    expect(refused.message).toContain('event-log store at version 2')
  })

  it('refuses a list that skips a version', async () => {
    const { client, context } = database()
    const refused = await Effect.runPromise(
      Effect.flip(migrateSpecterSqlite(context, [eventLogVersion2])),
    )
    expect(refused).toBeInstanceOf(SqliteMigrationFailure)
    expect(refused.message).toContain('needs its version 1 first')
    expect(await names(client, 'table')).toEqual([])
  })

  it('refuses tables it did not create, and rolls back every migration of the run', async () => {
    const { client, context } = database()
    // A table the database already has, as statements from before the
    // migrations created it, with an older shape.
    await client.execute(`CREATE TABLE specter_event_commits (
      idempotency_key TEXT PRIMARY KEY,
      last_event_order INTEGER NOT NULL
    )`)
    const failed = await Effect.runPromise(
      Effect.exit(prepareSpecterSqlite(context)),
    )
    expect(Exit.isFailure(failed)).toBe(true)
    const refused = await Effect.runPromise(
      Effect.flip(prepareSpecterSqlite(context)),
    )
    expect(refused).toBeInstanceOf(SqliteMigrationFailure)
    expect(refused.message).toContain("event-log store's migration 1")
    // Nothing of the run is left: the database is as it was.
    expect(await names(client, 'table')).toEqual(['specter_event_commits'])
  })

  it('never changes a released migration', () => {
    // A release that changes a store's tables adds a version; these are the
    // digests of the released ones.
    expect(
      Object.fromEntries(
        specterSqliteMigrations.map((migration) => [
          `${migration.store}@${migration.version}`,
          createHash('sha256')
            .update(JSON.stringify(migration.statements))
            .digest('hex')
            .slice(0, 16),
        ]),
      ),
    ).toEqual({
      'event-log@1': 'a36a5d276806584d',
      'slice-store@1': 'fbd768cd01d3280e',
      'slice-snapshots@1': '1db6292039922f73',
      'reaction-scheduler@1': 'c817590aaecc690f',
      'reaction-outbox@1': 'cb79851b9c4f83d1',
    })
  })

  it('numbers each store from 1, in order', () => {
    const stores = new Map<string, number[]>()
    for (const migration of specterSqliteMigrations)
      stores.set(migration.store, [
        ...(stores.get(migration.store) ?? []),
        migration.version,
      ])
    for (const versions of stores.values())
      expect(versions).toEqual(versions.map((_, index) => index + 1))
  })
})
