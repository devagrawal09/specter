import { createClient } from '@libsql/client'
import {
  createEventDefinition,
  createSpecterApp,
  EventLog,
  type EventLogDraft,
  implementCommand,
  type SliceStoreService,
} from '@specter-ts/core'
import {
  eventLogConformance,
  sliceSnapshotStoreConformance,
  sliceStoreConformance,
} from '@specter-ts/core/testing'
import type { ReactionOutboxClaim } from '@specter-ts/reaction-outbox'
import {
  type ReactionOutboxConformancePayload,
  reactionOutboxStoreConformance,
} from '@specter-ts/reaction-outbox/testing'
import { createCommandSlice, event } from '@specter-ts/spec'
import { Context, Effect, Exit, Layer, type Scope } from 'effect'
import type { SqlClient } from 'effect/sql'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createSqlClientDatabaseContext,
  createSqliteDatabaseContext,
  type SqliteDatabaseContext,
} from './database'
import {
  createSqliteEventLogService,
  type SqliteEventLogAppend,
  type SqliteEventLogPurge,
} from './event-log'
import { prepareSpecterSqlite, specterSqliteSchema } from './persistence'
import { createSqliteReactionOutboxStore } from './reaction-outbox'
import { createSqliteSliceSnapshotStore } from './slice-snapshot-store'
import { createSqliteSliceStoreService } from './slice-store'
import { makeNodeSqlClient } from './sql-client.fixture'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function databaseFile() {
  const directory = mkdtempSync(join(tmpdir(), 'specter-sqlite-host-'))
  directories.push(directory)
  return join(directory, 'host.db')
}

/**
 * A host's database: an Effect SqlClient with Specter's tables, as the host's
 * own migration creates them, beside a table of its own.
 */
const hostDatabase = Effect.gen(function* () {
  const sql = yield* makeNodeSqlClient(databaseFile())
  yield* Effect.forEach(
    [
      ...specterSqliteSchema,
      'CREATE TABLE host_note (event_id TEXT PRIMARY KEY, request TEXT)',
    ],
    (statement) => sql.unsafe(statement),
    { discard: true },
  )
  return sql
})

const run = <A, E>(program: Effect.Effect<A, E, Scope.Scope>) =>
  Effect.runPromise(Effect.scoped(program))

/** The same conformance over each driver a host may provide. */
const drivers: ReadonlyArray<
  readonly [string, Effect.Effect<SqliteDatabaseContext, unknown, Scope.Scope>]
> = [
  [
    'an Effect SqlClient',
    Effect.map(hostDatabase, (sql) => createSqlClientDatabaseContext(sql)),
  ],
  [
    'libSQL',
    Effect.gen(function* () {
      const client = createClient({ url: `file:${databaseFile()}` })
      yield* Effect.addFinalizer(() => Effect.sync(() => client.close()))
      const context = createSqliteDatabaseContext(client)
      yield* prepareSpecterSqlite(context)
      return context
    }),
  ],
]

describe.each(drivers)('SQLite stores on %s', (_name, database) => {
  it('conform to the Event Log contract', () =>
    run(
      Effect.gen(function* () {
        const context = yield* database
        yield* eventLogConformance(
          Effect.succeed(createSqliteEventLogService(context)),
        )
      }),
    ))

  it('conform to the Slice Store contract', () =>
    run(
      Effect.gen(function* () {
        const context = yield* database
        yield* sliceStoreConformance({
          createService: Effect.succeed(
            createSqliteSliceStoreService(context, () => ({ value: 0 })),
          ),
          write: async (state, value: number) => {
            state.value = value
          },
          read: async (state) => state.value,
          value: 7,
        })
      }),
    ))

  it('conform to the Slice snapshot store contract', () =>
    run(
      Effect.gen(function* () {
        const context = yield* database
        yield* sliceSnapshotStoreConformance(
          Effect.succeed(createSqliteSliceSnapshotStore(context)),
        )
      }),
    ))

  it('conform to the Reaction outbox Store contract', () =>
    run(
      Effect.gen(function* () {
        const context = yield* database
        yield* reactionOutboxStoreConformance(
          Effect.succeed(
            createSqliteReactionOutboxStore<ReactionOutboxConformancePayload>(
              context,
            ),
          ),
        )
      }),
    ))
})

const noteWritten = createEventDefinition('note-written', {
  '~standard': {
    version: 1,
    vendor: 'specter-sqlite-host-test',
    validate: (value) => ({ value: value as { readonly noteId: string } }),
  },
})

/** Writes the host's read model of each appended Event, with its request. */
function projectNotes(sql: SqlClient.SqlClient, seen: SqliteEventLogAppend[]) {
  return (append: SqliteEventLogAppend) =>
    Effect.gen(function* () {
      seen.push(append)
      for (const [index, appended] of append.commit.events.entries()) {
        const metadata = append.metadata[index] as
          | { readonly request?: string }
          | undefined
        yield* sql`INSERT INTO host_note (event_id, request)
          VALUES (${appended.id}, ${metadata?.request ?? null})`
      }
      return undefined
    })
}

const notes = (sql: SqlClient.SqlClient) =>
  sql<{
    readonly event_id: string
    readonly request: string | null
  }>`SELECT event_id, request FROM host_note ORDER BY event_id`

const draft = (noteId: string, metadata?: unknown): EventLogDraft => ({
  type: 'note-written',
  payload: { noteId },
  keys: {},
  id: noteId,
  ...(metadata === undefined ? {} : { metadata }),
})

describe('An Event Log embedded in its host', () => {
  it('runs the host hook in the append transaction, with each Event and its metadata', () =>
    run(
      Effect.gen(function* () {
        const sql = yield* hostDatabase
        const context = createSqlClientDatabaseContext(sql)
        const seen: SqliteEventLogAppend[] = []
        const eventLog = createSqliteEventLogService(context, {
          onAppend: projectNotes(sql, seen),
        })
        const appended = yield* eventLog.append(
          [draft('n1', { request: 'r1' }), draft('n2')],
          { idempotencyKey: 'write-1' },
        )
        // A duplicate appends nothing, so no hook runs.
        yield* eventLog.append([draft('n3')], { idempotencyKey: 'write-1' })

        expect(yield* notes(sql)).toEqual([
          { event_id: 'n1', request: 'r1' },
          { event_id: 'n2', request: null },
        ])
        expect(seen).toHaveLength(1)
        expect(seen[0]?.commit).toEqual({
          events: appended.events,
          version: appended.version,
          committedAt: appended.committedAt,
          idempotencyKey: 'write-1',
          fingerprint: undefined,
        })
        expect(seen[0]?.metadata).toEqual([{ request: 'r1' }, undefined])
      }),
    ))

  it('rolls the append and the host writes back when the hook fails', () =>
    run(
      Effect.gen(function* () {
        const sql = yield* hostDatabase
        const context = createSqlClientDatabaseContext(sql)
        const project = projectNotes(sql, [])
        const eventLog = createSqliteEventLogService(context, {
          onAppend: (append) =>
            project(append).pipe(
              Effect.andThen(Effect.fail(new Error('projection failed'))),
            ),
        })
        const failed = yield* Effect.exit(eventLog.append([draft('n1')]))
        expect(Exit.isFailure(failed)).toBe(true)
        expect(yield* eventLog.currentVersion).toBe(0)
        expect(yield* notes(sql)).toEqual([])
      }),
    ))

  it('runs what the hook leaves for after the commit once the append is durable', () =>
    run(
      Effect.gen(function* () {
        const sql = yield* hostDatabase
        const context = createSqlClientDatabaseContext(sql)
        const observed: number[] = []
        const eventLog = createSqliteEventLogService(context, {
          onAppend: () =>
            Effect.succeed(
              // Outside the transaction, so another reader sees the commit.
              Effect.flatMap(
                sql<{ readonly count: number }>`SELECT count(*) AS count
                  FROM specter_events`,
                ([row]) =>
                  Effect.sync(() => {
                    observed.push(row?.count ?? -1)
                  }),
              ).pipe(Effect.orDie),
            ),
        })
        yield* eventLog.append([draft('n1')])
        yield* eventLog.append([draft('n2')])
        expect(observed).toEqual([1, 2])
      }),
    ))

  it("appends inside the host's transaction, and rolls back with it", () =>
    run(
      Effect.gen(function* () {
        const sql = yield* hostDatabase
        let transactions = 0
        // The host's own transaction runner, as an ORM's would be.
        const context = createSqlClientDatabaseContext(sql, {
          transaction: (effect) =>
            Effect.suspend(() => {
              transactions += 1
              return sql.withTransaction(effect)
            }),
        })
        const eventLog = createSqliteEventLogService(context)
        const failed = yield* Effect.exit(
          context.transaction(() =>
            Effect.gen(function* () {
              yield* sql`INSERT INTO host_note (event_id) VALUES ('host')`
              yield* eventLog.append([draft('n1')])
              return yield* Effect.fail(new Error('host failed'))
            }),
          ),
        )
        expect(Exit.isFailure(failed)).toBe(true)
        expect(yield* eventLog.currentVersion).toBe(0)
        expect(yield* notes(sql)).toEqual([])
        yield* eventLog.append([draft('n2')])
        expect(yield* eventLog.currentVersion).toBe(1)
        // The outer transaction and each append ran through the host's runner.
        expect(transactions).toBe(3)
      }),
    ))

  it("records a dispatch's Events with their context, and the host projects them", () =>
    run(
      Effect.gen(function* () {
        const sql = yield* hostDatabase
        const context = createSqlClientDatabaseContext(sql)
        const eventLog = createSqliteEventLogService(context, {
          onAppend: projectNotes(sql, []),
        })
        class NotesStore extends Context.Service<
          NotesStore,
          SliceStoreService<
            Readonly<{ count: number }>,
            { count: number },
            unknown
          >
        >()('specter-sqlite-host-test/NotesStore') {}
        const writeNote = implementCommand(
          createCommandSlice('writeNote')
            .description('Writes a note.')
            .scenarios({
              description: 'Writes one note.',
              given: [],
              when: { noteId: 'n1' },
              expect: [event('note-written', { noteId: 'n1' })],
            }),
        )
          .inputSchema<{ readonly noteId: string }>()
          .store(NotesStore)
          .handle(async (note) => [noteWritten.create(note)])
        const app = yield* Effect.promise(() =>
          createSpecterApp(
            { events: [noteWritten], slices: { writeNote } },
            Layer.mergeAll(
              Layer.succeed(EventLog, eventLog),
              Layer.succeed(
                NotesStore,
                createSqliteSliceStoreService(context, () => ({ count: 0 })),
              ),
            ),
          ),
        )
        yield* Effect.addFinalizer(() => Effect.promise(() => app.close()))
        yield* Effect.promise(() =>
          app.command(
            { type: 'writeNote', payload: { noteId: 'n1' } },
            {
              eventContext: () => ({
                id: 'evt-n1',
                metadata: { request: 'request-1' },
              }),
            },
          ),
        )
        expect(yield* notes(sql)).toEqual([
          { event_id: 'evt-n1', request: 'request-1' },
        ])
      }),
    ))
})

describe("A purge in its host's database", () => {
  /**
   * A host's index of the log by order, which refers to each Event, as an
   * index by aggregate does.
   */
  const indexedDatabase = Effect.gen(function* () {
    const sql = yield* hostDatabase
    yield* sql`PRAGMA foreign_keys = ON`
    yield* sql`CREATE TABLE host_index (
      event_order INTEGER PRIMARY KEY REFERENCES specter_events(event_order),
      note TEXT NOT NULL
    )`
    return sql
  })
  const indexed = (sql: SqlClient.SqlClient) =>
    sql<{ readonly event_order: number }>`SELECT event_order FROM host_index
      ORDER BY event_order`.pipe(
      Effect.map((rows) => rows.map((row) => row.event_order)),
    )
  const keyed = (noteId: string, session: string): EventLogDraft => ({
    type: noteId.startsWith('deleted') ? 'session-deleted' : 'note-written',
    payload: { noteId },
    keys: { session },
  })

  it('runs the host hook in the purge transaction, before it deletes', () =>
    run(
      Effect.gen(function* () {
        const sql = yield* indexedDatabase
        const context = createSqlClientDatabaseContext(sql)
        const seen: SqliteEventLogPurge[] = []
        const eventLog = createSqliteEventLogService(context, {
          onAppend: ({ commit }) =>
            Effect.forEach(
              commit.events,
              (event) =>
                sql`INSERT INTO host_index (event_order, note)
                  VALUES (${event.order}, ${event.id})`,
              { discard: true },
            ).pipe(Effect.as(undefined)),
          onPurge: (purge) =>
            Effect.gen(function* () {
              seen.push(purge)
              yield* sql`DELETE FROM host_index
                WHERE event_order IN ${sql.in(purge.orders)}`
            }),
        })
        yield* eventLog.append([keyed('n1', 's1'), keyed('n2', 's2')])
        yield* eventLog.append([keyed('n3', 's1'), keyed('deleted-1', 's1')])
        const purged = yield* eventLog.purge(
          { name: 'session', value: 's1' },
          { keep: ['session-deleted'] },
        )
        expect(purged).toEqual({ purged: 2 })
        expect(seen).toEqual([
          {
            key: { name: 'session', value: 's1' },
            keep: ['session-deleted'],
            orders: [1, 3],
          },
        ])
        // The host's rows went with the Events they referred to.
        expect(yield* indexed(sql)).toEqual([2, 4])
        // Nothing left to purge runs no hook.
        expect(
          yield* eventLog.purge(
            { name: 'session', value: 's1' },
            { keep: ['session-deleted'] },
          ),
        ).toEqual({ purged: 0 })
        expect(seen).toHaveLength(1)
      }),
    ))

  it('rolls the purge back when the hook fails, or when a reference the host left fails it', () =>
    run(
      Effect.gen(function* () {
        const sql = yield* indexedDatabase
        const context = createSqlClientDatabaseContext(sql)
        let fail = true
        const eventLog = createSqliteEventLogService(context, {
          onAppend: ({ commit }) =>
            Effect.forEach(
              commit.events,
              (event) =>
                sql`INSERT INTO host_index (event_order, note)
                  VALUES (${event.order}, ${event.id})`,
              { discard: true },
            ).pipe(Effect.as(undefined)),
          onPurge: () =>
            fail ? Effect.fail(new Error('index failed')) : Effect.void,
        })
        yield* eventLog.append([keyed('n1', 's1'), keyed('n2', 's2')])
        const key = { name: 'session', value: 's1' }
        const failed = yield* Effect.exit(eventLog.purge(key))
        // The hook ran and kept its row: the Event it refers to cannot go.
        fail = false
        const refused = yield* Effect.exit(eventLog.purge(key))
        expect(Exit.isFailure(failed)).toBe(true)
        expect(Exit.isFailure(refused)).toBe(true)
        expect(
          (yield* eventLog.readKey(key)).map((event) => event.order),
        ).toEqual([1])
        expect(yield* indexed(sql)).toEqual([1, 2])
      }),
    ))
})

describe('SQLite Reaction outbox queues', () => {
  const job = (id: string, requested: number) => ({
    id,
    idempotencyKey: id,
    payload: { id },
    requestedAt: new Date(requested),
    availableAt: new Date(requested),
  })

  it('keeps each queue apart in one table', () =>
    run(
      Effect.gen(function* () {
        const context = createSqlClientDatabaseContext(yield* hostDatabase)
        const steps = createSqliteReactionOutboxStore(context, {
          queue: 'steps',
        })
        const drives = createSqliteReactionOutboxStore(context, {
          queue: 'drives',
        })
        yield* steps.enqueue(job('delivery-1', 1))
        // The same job ID and idempotency key in another queue is its own job.
        const other = yield* drives.enqueue(job('delivery-1', 2))
        expect(other.created).toBe(true)
        expect((yield* steps.claimNext(new Date(10), new Date(100)))?.id).toBe(
          'delivery-1',
        )
        expect(yield* steps.claimNext(new Date(10), new Date(100))).toBe(
          undefined,
        )
        expect((yield* drives.list('pending')).map((item) => item.id)).toEqual([
          'delivery-1',
        ])
      }),
    ))

  it('releases what an earlier process left running, and prunes completed jobs', () =>
    run(
      Effect.gen(function* () {
        const context = createSqlClientDatabaseContext(yield* hostDatabase)
        const before = createSqliteReactionOutboxStore(context, {
          queue: 'steps',
        })
        const other = createSqliteReactionOutboxStore(context, {
          queue: 'drives',
        })
        yield* other.enqueue(job('elsewhere', 0))
        yield* other.claimNext(new Date(10), new Date(100_000))
        for (const id of ['running', 'dead', 'done', 'old'])
          yield* before.enqueue(job(id, 1))
        const claims: ReactionOutboxClaim<unknown>[] = []
        for (let index = 0; index < 4; index += 1) {
          const claim = yield* before.claimNext(new Date(10), new Date(100_000))
          if (claim) claims.push(claim)
        }
        const claimed = (id: string) => {
          const claim = claims.find((candidate) => candidate.id === id)
          if (!claim) throw new Error(`Expected a claim of ${id}`)
          return claim
        }
        const [done, dead, old] = [
          claimed('done'),
          claimed('dead'),
          claimed('old'),
        ]
        yield* before.deadLetter(
          dead.id,
          dead.activeAttemptId,
          new Date(11),
          'gave up',
        )
        yield* before.complete(done.id, done.activeAttemptId, new Date(50))
        yield* before.complete(old.id, old.activeAttemptId, new Date(20))

        const after = createSqliteReactionOutboxStore(context, {
          queue: 'steps',
        })
        let wakes = 0
        after.subscribe(() => {
          wakes += 1
        })
        expect(yield* after.release(new Date(60))).toBe(1)
        expect(yield* after.get('running')).toMatchObject({
          status: 'pending',
          attemptCount: 0,
          availableAt: new Date(60),
        })
        expect(yield* after.release(new Date(70), { deadLetters: true })).toBe(
          1,
        )
        expect(yield* after.get('dead')).toMatchObject({
          status: 'pending',
          attemptCount: 0,
        })
        expect(wakes).toBe(2)
        // Another queue's running job is not this queue's to release.
        expect((yield* other.get('elsewhere'))?.status).toBe('running')

        expect(yield* after.prune(new Date(30))).toBe(1)
        expect((yield* after.list()).map((item) => item.id).sort()).toEqual([
          'dead',
          'done',
          'running',
        ])
      }),
    ))
})
