import { randomUUID } from 'node:crypto'

import {
  EventLog,
  EventLogFailure,
  SpecterVersionConflictError,
  type EventKey,
  type EventLogAppendCondition,
  type EventLogPurgeOptions,
  type EventLogPurgeResult,
  type EventLogAppendOptions,
  type EventLogAppendResult,
  type EventLogCommit,
  type EventLogDraft,
  type EventLogKeyPage,
  type EventLogPage,
  type EventLogService,
  type PersistedEvent,
} from '@specter-ts/core'
import { Effect, Layer } from 'effect'

import {
  executeAll,
  requireNumber,
  requireString,
  type SqliteDatabaseContext,
  type SqliteRow,
  type SqliteValue,
} from './database'

export type SqliteEventCodec = {
  encode(payload: unknown): string
  decode(payload: string): unknown
}

/** One commit an append stored, as the append's transaction hands it to the host. */
export type SqliteEventLogAppend = {
  /** The commit, as `append` returns it. */
  readonly commit: EventLogCommit
  /**
   * The metadata each Event's draft carried (`EventLogDraft.metadata`, the
   * dispatch's `eventContext`), by position; undefined where it had none.
   */
  readonly metadata: readonly unknown[]
}

/** One purge, as its transaction hands it to the host before it deletes. */
export type SqliteEventLogPurge = {
  /** The key whose Events the purge removes. */
  readonly key: EventKey
  /** The Event types it keeps though they carry the key. */
  readonly keep: readonly string[]
  /** The orders of the Events it removes, ascending; never empty. */
  readonly orders: readonly number[]
}

export type SqliteEventLogOptions = {
  readonly eventId?: () => string
  readonly now?: () => Date
  readonly codec?: SqliteEventCodec
  /**
   * Runs inside each append's transaction once its Events and keys are
   * stored, with the commit and each Event's metadata: a host writes its own
   * read models here, so they change with the log or not at all. Its failure
   * rolls the append back and fails it. It may return an Effect to run once
   * the transaction has committed, such as notifying listeners; the append
   * runs it before it returns, uninterruptibly. A duplicate (a known
   * idempotency key) appends nothing and runs no hook.
   */
  readonly onAppend?: (
    append: SqliteEventLogAppend,
  ) => Effect.Effect<Effect.Effect<void> | undefined, unknown>
  /**
   * Runs inside each purge's transaction before it deletes anything, with
   * the orders of the Events it removes: a host removes its own rows that
   * refer to them (an index of the log by order), so they go with the
   * Events or not at all. Its failure rolls the purge back and fails it. A
   * purge that finds nothing to remove runs no hook.
   */
  readonly onPurge?: (
    purge: SqliteEventLogPurge,
  ) => Effect.Effect<void, unknown>
}

export type SqliteEventLogService = EventLogService & {
  readonly context: SqliteDatabaseContext
}

type CommitTableShape = 'versioned' | 'legacy'

const jsonCodec: SqliteEventCodec = {
  encode(payload) {
    const encoded = JSON.stringify(payload)
    if (encoded === undefined) {
      throw new Error('SQLite Event payload must be JSON-serializable')
    }
    return encoded
  },
  decode: JSON.parse,
}

/**
 * The statements that create the Event Log's tables and indexes. A host that
 * runs its own migrations runs them in one; `prepareSqliteEventLog` runs them
 * for a host that does not.
 */
export const sqliteEventLogSchema: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS specter_events (
    event_order INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    recorded_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS specter_events_type_order_idx
    ON specter_events(type, event_order)`,
  `CREATE TABLE IF NOT EXISTS specter_event_commits (
    commit_version INTEGER PRIMARY KEY,
    idempotency_key TEXT UNIQUE,
    fingerprint TEXT,
    first_event_order INTEGER NOT NULL,
    last_event_order INTEGER NOT NULL,
    committed_at TEXT NOT NULL
  )`,
  // Each Event's named keys, as core derived them when it was appended.
  `CREATE TABLE IF NOT EXISTS specter_event_keys (
    event_order INTEGER NOT NULL REFERENCES specter_events(event_order),
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (event_order, name)
  )`,
  `CREATE INDEX IF NOT EXISTS specter_event_keys_name_value_order_idx
    ON specter_event_keys(name, value, event_order)`,
  // The highest order a purge removed, by Event type: the log's version
  // never moves back, and a decision that read before a removed Event was
  // appended stays stale.
  `CREATE TABLE IF NOT EXISTS specter_event_purges (
    type TEXT PRIMARY KEY,
    through_order INTEGER NOT NULL
  )`,
]

export function prepareSqliteEventLog(context: SqliteDatabaseContext) {
  return executeAll(context, sqliteEventLogSchema)
}

/**
 * An Event's columns, with the keys stored with it as one JSON object, for a
 * query whose `specter_events` alias is `e`.
 */
const eventColumns = `e.id, e.event_order, e.type, e.payload, e.recorded_at,
  (SELECT json_group_object(stored.name, stored.value)
    FROM specter_event_keys stored
    WHERE stored.event_order = e.event_order) AS event_keys`

/** The keys stored with an Event, from their JSON object column. */
function storedKeys(value: unknown): Readonly<Record<string, string>> {
  const keys: unknown = JSON.parse(requireString(value, 'event keys'))
  if (
    typeof keys !== 'object' ||
    keys === null ||
    Array.isArray(keys) ||
    !Object.values(keys).every((key) => typeof key === 'string')
  ) {
    throw new Error('Expected SQLite event keys to be an object of strings')
  }
  return keys as Readonly<Record<string, string>>
}

const placeholders = (values: readonly unknown[]) =>
  values.map(() => '?').join(', ')

/**
 * Specter's Event Log on a SQLite database the host provides. Appends run in
 * the database's transaction, joining the host's when it runs one, and hand
 * each commit to `onAppend` before it commits.
 */
export function createSqliteEventLogService(
  context: SqliteDatabaseContext,
  options: SqliteEventLogOptions = {},
): SqliteEventLogService {
  const eventId = options.eventId ?? randomUUID
  const now = options.now ?? (() => new Date())
  const codec = options.codec ?? jsonCodec
  let commitTableShape: CommitTableShape | undefined

  const rows = (sql: string, args: readonly SqliteValue[] = []) =>
    context.execute(sql, args)
  const decode = <A>(run: () => A) =>
    Effect.try({ try: run, catch: (cause) => cause })

  function getCommitTableShape() {
    if (commitTableShape) return Effect.succeed(commitTableShape)
    return rows('PRAGMA table_info(specter_event_commits)').pipe(
      Effect.flatMap((columns) =>
        decode(() => {
          const names = new Set(
            columns.map((row) =>
              requireString(row.name, 'Event commit table column name'),
            ),
          )
          if (names.has('commit_version')) return 'versioned' as const
          if (names.has('idempotency_key') && names.has('last_event_order')) {
            return 'legacy' as const
          }
          throw new Error('Unsupported SQLite Event commit table schema')
        }),
      ),
      Effect.tap((shape) =>
        Effect.sync(() => {
          commitTableShape = shape
        }),
      ),
    )
  }

  function fromRow(row: SqliteRow): PersistedEvent {
    const recordedAt = requireString(row.recorded_at, 'recorded time')
    if (Number.isNaN(Date.parse(recordedAt))) {
      throw new Error('Expected SQLite recorded time to be ISO-8601')
    }
    return {
      id: requireString(row.id, 'event id'),
      order: requireNumber(row.event_order, 'event order'),
      type: requireString(row.type, 'event type'),
      payload: codec.decode(requireString(row.payload, 'event payload')),
      recordedAt,
      keys: storedKeys(row.event_keys),
    }
  }

  const events = (found: readonly SqliteRow[]) =>
    decode(() => found.map(fromRow))

  function query(
    afterOrder: number,
    eventTypes: readonly string[],
    page: EventLogPage,
  ) {
    if (!eventTypes.length) return Effect.succeed([])
    return rows(
      `SELECT ${eventColumns}
        FROM specter_events e
        WHERE event_order > ? AND type IN (${placeholders(eventTypes)})
        ORDER BY event_order ASC
        LIMIT ?`,
      [afterOrder, ...eventTypes, page.limit ?? -1],
    ).pipe(Effect.flatMap(events))
  }

  /**
   * The order of the first Event appended after the condition's read that it
   * covers, or undefined when there is none. Checked in SQL, from the stored
   * keys.
   */
  function staleOrder(condition: EventLogAppendCondition) {
    if (condition.eventTypes.length === 0) return Effect.succeed(undefined)
    const types = placeholders(condition.eventTypes)
    const keys = Object.entries(condition.keys ?? {}).filter(
      ([, values]) => values.length > 0,
    )
    if (condition.keys && keys.length === 0) return Effect.succeed(undefined)
    // A purge removed an Event of the condition's types after its read:
    // stale whatever the Event's keys were.
    const purged = rows(
      `SELECT through_order AS event_order FROM specter_event_purges
        WHERE through_order > ? AND type IN (${types})
        ORDER BY through_order ASC LIMIT 1`,
      [condition.afterOrder, ...condition.eventTypes],
    )
    const found = condition.keys
      ? rows(
          `SELECT k.event_order FROM specter_event_keys k
            JOIN specter_events e ON e.event_order = k.event_order
            WHERE k.event_order > ? AND e.type IN (${types})
              AND (${keys
                .map(
                  ([, values]) =>
                    `(k.name = ? AND k.value IN (${placeholders(values)}))`,
                )
                .join(' OR ')})
            ORDER BY k.event_order ASC LIMIT 1`,
          [
            condition.afterOrder,
            ...condition.eventTypes,
            ...keys.flatMap(([name, values]) => [name, ...values]),
          ],
        )
      : rows(
          `SELECT event_order FROM specter_events
            WHERE event_order > ? AND type IN (${types})
            ORDER BY event_order ASC LIMIT 1`,
          [condition.afterOrder, ...condition.eventTypes],
        )
    return Effect.flatMap(found, (stored) =>
      stored.length > 0 ? Effect.succeed(stored) : purged,
    ).pipe(
      Effect.flatMap(([row]) =>
        decode(() =>
          row ? requireNumber(row.event_order, 'stale event order') : undefined,
        ),
      ),
    )
  }

  function readKey(key: EventKey, page: EventLogKeyPage) {
    return rows(
      `SELECT ${eventColumns}
        FROM specter_event_keys k
        JOIN specter_events e ON e.event_order = k.event_order
        WHERE k.name = ? AND k.value = ? AND k.event_order > ?
        ORDER BY k.event_order ASC
        LIMIT ?`,
      [key.name, key.value, page.afterOrder ?? 0, page.limit ?? -1],
    ).pipe(Effect.flatMap(events))
  }

  // The highest order the log ever assigned: its Events' or, when a purge
  // removed the latest ones, the purge's.
  const currentVersion = rows(
    `SELECT MAX(
        COALESCE((SELECT MAX(event_order) FROM specter_events), 0),
        COALESCE((SELECT MAX(through_order) FROM specter_event_purges), 0)
      ) AS version`,
  ).pipe(
    Effect.flatMap(([row]) =>
      decode(() => requireNumber(row?.version, 'Event Log version')),
    ),
  )

  const commitColumns = `idempotency_key, fingerprint, first_event_order,
    last_event_order, committed_at`

  /**
   * The commits of these rows with their Events. A commit's Events are the
   * orders from its first to its last, and commits never overlap, so one
   * read finds every commit's Events.
   */
  function withEvents(commitRows: readonly SqliteRow[]) {
    return Effect.gen(function* () {
      const commits = yield* decode(() =>
        commitRows.map((row) => {
          const committedAt = requireString(row.committed_at, 'commit time')
          if (Number.isNaN(Date.parse(committedAt))) {
            throw new Error('Expected SQLite commit time to be ISO-8601')
          }
          return {
            first: requireNumber(
              row.first_event_order,
              'first commit event order',
            ),
            version: requireNumber(row.last_event_order, 'commit version'),
            committedAt,
            idempotencyKey:
              row.idempotency_key === null
                ? undefined
                : requireString(row.idempotency_key, 'commit idempotency key'),
            fingerprint:
              row.fingerprint === null
                ? undefined
                : requireString(row.fingerprint, 'commit fingerprint'),
          }
        }),
      )
      if (commits.length === 0) return []
      const stored = yield* rows(
        `SELECT ${eventColumns}
          FROM specter_events e
          WHERE event_order BETWEEN ? AND ?
          ORDER BY event_order ASC`,
        [
          Math.min(...commits.map((commit) => commit.first)),
          Math.max(...commits.map((commit) => commit.version)),
        ],
      ).pipe(Effect.flatMap(events))
      // Both are ordered, so one pass splits the Events by commit.
      let index = 0
      return commits.map(({ first, ...commit }): EventLogCommit => {
        while (index < stored.length && (stored[index]?.order ?? 0) < first)
          index += 1
        const start = index
        while (
          index < stored.length &&
          (stored[index]?.order ?? 0) <= commit.version
        )
          index += 1
        return { ...commit, events: stored.slice(start, index) }
      })
    })
  }

  function findCommit(idempotencyKey: string) {
    return rows(
      `SELECT ${commitColumns} FROM specter_event_commits
        WHERE idempotency_key = ?`,
      [idempotencyKey],
    ).pipe(
      Effect.flatMap(withEvents),
      Effect.map(([commit]) => commit),
    )
  }

  function commitsAfter(afterVersion: number, page: EventLogPage) {
    return getCommitTableShape().pipe(
      Effect.flatMap((shape) => {
        const versionColumn =
          shape === 'versioned' ? 'commit_version' : 'last_event_order'
        return rows(
          `SELECT ${commitColumns} FROM specter_event_commits
            WHERE ${versionColumn} > ?
            ORDER BY ${versionColumn} ASC
            LIMIT ?`,
          [afterVersion, page.limit ?? -1],
        )
      }),
      Effect.flatMap(withEvents),
    )
  }

  /** Stores one commit and runs the host's hook, inside the transaction. */
  function store(
    drafts: readonly EventLogDraft[],
    appendOptions: EventLogAppendOptions,
  ) {
    return Effect.gen(function* () {
      const existing = appendOptions.idempotencyKey
        ? yield* findCommit(appendOptions.idempotencyKey)
        : undefined
      if (existing) {
        return {
          result: { ...existing, duplicate: true } as EventLogAppendResult,
          committed: undefined,
        }
      }
      if (drafts.length === 0) {
        return yield* Effect.fail(
          new Error('Event Log append requires at least one Event'),
        )
      }

      const tableShape = yield* getCommitTableShape()
      const version = yield* currentVersion
      if (
        appendOptions.expectedVersion !== undefined &&
        appendOptions.expectedVersion !== version
      ) {
        return yield* Effect.fail(
          new SpecterVersionConflictError(
            appendOptions.expectedVersion,
            version,
          ),
        )
      }
      const unchanged = appendOptions.expectedUnchanged
      const stale = unchanged ? yield* staleOrder(unchanged) : undefined
      if (unchanged && stale !== undefined) {
        return yield* Effect.fail(
          new SpecterVersionConflictError(unchanged.afterOrder, stale),
        )
      }

      const appended: PersistedEvent[] = []
      for (const draft of drafts) {
        // The host's ID and time when it supplied them. The ID column is
        // unique, so an ID already in the log fails the append.
        const id = draft.id ?? eventId()
        const recordedAt = draft.recordedAt ?? now().toISOString()
        if (Number.isNaN(Date.parse(recordedAt))) {
          return yield* Effect.fail(
            new Error('Event recordedAt must be an ISO-8601 timestamp'),
          )
        }
        const payload = yield* decode(() => codec.encode(draft.payload))
        const [inserted] = yield* rows(
          `INSERT INTO specter_events (id, type, payload, recorded_at)
            VALUES (?, ?, ?, ?)
            RETURNING event_order`,
          [id, draft.type, payload, recordedAt],
        )
        const order = yield* decode(() =>
          requireNumber(inserted?.event_order, 'inserted event order'),
        )
        const keys = Object.entries(draft.keys)
        if (keys.length > 0) {
          yield* rows(
            `INSERT INTO specter_event_keys (event_order, name, value)
              VALUES ${keys.map(() => '(?, ?, ?)').join(', ')}`,
            keys.flatMap(([name, value]) => [order, name, value]),
          )
        }
        appended.push({
          type: draft.type,
          payload: draft.payload,
          id,
          order,
          recordedAt,
          keys: { ...draft.keys },
        })
      }
      const committedVersion = appended.at(-1)?.order ?? version
      const committedAt = now().toISOString()
      const first = appended[0]?.order ?? version
      if (tableShape === 'versioned') {
        yield* rows(
          `INSERT INTO specter_event_commits (
              commit_version, idempotency_key, fingerprint,
              first_event_order, last_event_order, committed_at
            ) VALUES (?, ?, ?, ?, ?, ?)`,
          [
            committedVersion,
            appendOptions.idempotencyKey ?? null,
            appendOptions.fingerprint ?? null,
            first,
            committedVersion,
            committedAt,
          ],
        )
      } else {
        yield* rows(
          `INSERT INTO specter_event_commits (
              idempotency_key, fingerprint, first_event_order,
              last_event_order, committed_at
            ) VALUES (?, ?, ?, ?, ?)`,
          [
            appendOptions.idempotencyKey ?? null,
            appendOptions.fingerprint ?? null,
            first,
            committedVersion,
            committedAt,
          ],
        )
      }
      const commit: EventLogCommit = {
        events: appended,
        version: committedVersion,
        committedAt,
        idempotencyKey: appendOptions.idempotencyKey,
        fingerprint: appendOptions.fingerprint,
      }
      const committed = options.onAppend
        ? yield* options.onAppend({
            commit,
            metadata: drafts.map((draft) => draft.metadata),
          })
        : undefined
      return {
        result: { ...commit, duplicate: false } as EventLogAppendResult,
        committed,
      }
    })
  }

  /** Removes a key's Events but the kept types, inside the transaction. */
  function remove(key: EventKey, keep: readonly string[]) {
    return Effect.gen(function* () {
      const found = yield* rows(
        `SELECT e.event_order, e.type FROM specter_event_keys k
          JOIN specter_events e ON e.event_order = k.event_order
          WHERE k.name = ? AND k.value = ?${
            keep.length > 0 ? ` AND e.type NOT IN (${placeholders(keep)})` : ''
          }
          ORDER BY e.event_order ASC`,
        [key.name, key.value, ...keep],
      )
      const removed = yield* decode(() =>
        found.map((row) => ({
          order: requireNumber(row.event_order, 'purged event order'),
          type: requireString(row.type, 'purged event type'),
        })),
      )
      if (removed.length === 0) return { purged: 0 }
      const orders = removed.map((event) => event.order)
      if (options.onPurge) yield* options.onPurge({ key, keep, orders })
      const through = new Map<string, number>()
      for (const event of removed) {
        through.set(
          event.type,
          Math.max(through.get(event.type) ?? 0, event.order),
        )
      }
      yield* rows(
        `INSERT INTO specter_event_purges (type, through_order)
          VALUES ${[...through].map(() => '(?, ?)').join(', ')}
          ON CONFLICT(type) DO UPDATE SET
            through_order = MAX(through_order, excluded.through_order)`,
        [...through].flat(),
      )
      // In chunks, within SQLite's limit on bound parameters.
      for (let start = 0; start < orders.length; start += purgeChunk) {
        const chunk = orders.slice(start, start + purgeChunk)
        yield* rows(
          `DELETE FROM specter_event_keys
            WHERE event_order IN (${placeholders(chunk)})`,
          chunk,
        )
        yield* rows(
          `DELETE FROM specter_events
            WHERE event_order IN (${placeholders(chunk)})`,
          chunk,
        )
      }
      // A commit left with no Events goes, with its idempotency receipt.
      yield* rows(
        `DELETE FROM specter_event_commits
          WHERE last_event_order >= ? AND first_event_order <= ?
            AND NOT EXISTS (
              SELECT 1 FROM specter_events e
              WHERE e.event_order BETWEEN specter_event_commits.first_event_order
                AND specter_event_commits.last_event_order
            )`,
        [orders[0] as number, orders[orders.length - 1] as number],
      )
      return { purged: removed.length } satisfies EventLogPurgeResult
    })
  }

  function attempt<A, E>(
    operation: EventLogFailure['operation'],
    effect: Effect.Effect<A, E>,
  ) {
    return effect.pipe(
      Effect.mapError((cause) =>
        cause instanceof EventLogFailure
          ? cause
          : new EventLogFailure(operation, cause),
      ),
    )
  }

  return {
    capabilities: { scopedAppend: true, keyedRead: true, purge: true },
    context,
    query: (afterOrder, eventTypes, page = {}) =>
      attempt('query', query(afterOrder, eventTypes, page)),
    currentVersion: attempt('currentVersion', currentVersion),
    readKey: (key, page = {}) => attempt('readKey', readKey(key, page)),
    commitsAfter: (afterVersion, page = {}) =>
      attempt('commitsAfter', commitsAfter(afterVersion, page)),
    findCommit: (idempotencyKey) =>
      attempt('findCommit', findCommit(idempotencyKey)),
    append: (drafts, appendOptions = {}) =>
      attempt(
        'append',
        context.transaction(() => store(drafts, appendOptions)),
      ).pipe(
        // A committed append always runs what its hook left for after the
        // commit.
        Effect.tap(({ committed }) => committed ?? Effect.void),
        Effect.map(({ result }) => result),
        Effect.uninterruptible,
      ),
    purge: (key, purgeOptions: EventLogPurgeOptions = {}) =>
      attempt(
        'purge',
        context.transaction(() => remove(key, purgeOptions.keep ?? [])),
      ).pipe(Effect.uninterruptible),
  }
}

// Orders deleted per statement, well within SQLite's bound parameter limit.
const purgeChunk = 500

export function createSqliteEventLogLayer(
  context: SqliteDatabaseContext,
  options: SqliteEventLogOptions = {},
): Layer.Layer<EventLog> {
  return Layer.succeed(EventLog, createSqliteEventLogService(context, options))
}
