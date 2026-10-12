import { randomUUID } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  ftruncateSync,
  openSync,
  readFileSync,
  renameSync,
  truncateSync,
  unlinkSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'

import {
  EventLog,
  EventLogFailure,
  SpecterVersionConflictError,
  type EventLogAppendCondition,
  type EventLogAppendOptions,
  type EventLogAppendResult,
  type EventLogCommit,
  type EventLogDraft,
  type EventLogService,
  type PersistedEvent,
} from '@specter-ts/core'
import { Effect, Layer } from 'effect'

import {
  acquireLock,
  closeQuietly,
  type JsonlStaleLock,
  writeAll,
} from './file-lock'

export type JsonlEventLogOptions = {
  readonly path: string
  /** Call `fsync` after every append. Off by default. */
  readonly fsync?: boolean
  readonly eventId?: () => string
  readonly now?: () => Date
  /**
   * Called once after a successful open with what the open recovered, so a
   * Layer user can observe it too. If it throws, the log is closed and the
   * open fails with that error.
   */
  readonly onOpen?: (info: JsonlEventLogOpenInfo) => void
}

/** What opening a JSONL Event Log recovered. */
export type JsonlEventLogOpenInfo = {
  /** Holder of a lock file taken over while opening; it had exited. */
  readonly recoveredStaleLock: JsonlStaleLock | undefined
  /** Bytes of an interrupted trailing write removed while opening. */
  readonly discardedTrailingBytes: number
}

export type JsonlEventLog = EventLogService & {
  readonly path: string
  /** Bytes of an interrupted trailing write removed while opening. */
  readonly discardedTrailingBytes: number
  /** Holder of a lock file taken over while opening; it had exited. */
  readonly recoveredStaleLock: JsonlStaleLock | undefined
  readonly close: () => void
}

/**
 * Opens one append-only JSONL file as an Event Log. Each line is one complete
 * commit, so a line boundary is the atomic commit boundary; each Event in it
 * keeps the keys it was appended with. Opening takes an
 * exclusive `<path>.lock` file, released by `close()`, so the opener is the
 * file's only writer; a lock left by an exited process on this host is taken
 * over and reported as `recoveredStaleLock`, on the log and to `onOpen`.
 *
 * A purge rewrites the file without the Events it removes, through a
 * temporary file renamed over it, under a first line that keeps the highest
 * order the log assigned and, by Event type, the highest order a purge
 * removed (`{"purged":{...},"version":N}`).
 */
export function createJsonlEventLog(
  options: JsonlEventLogOptions,
): JsonlEventLog {
  const eventId = options.eventId ?? randomUUID
  const now = options.now ?? (() => new Date())
  const { release: releaseLock, recoveredStaleLock } = acquireLock(
    resolve(options.path),
    'JSONL Event Log',
  )
  let opened: ReturnType<typeof openFile>
  try {
    opened = openFile(options.path, options.fsync === true)
  } catch (cause) {
    releaseLock()
    throw cause
  }
  const { discardedTrailingBytes } = opened
  let commits = opened.commits
  let fd: number | undefined = opened.fd
  let committedBytes = opened.size
  let closed = false
  /** Set when a failed write could not be undone; every later append fails. */
  let poisoned: AggregateError | undefined
  // The Events in order. A purge leaves gaps, so an Event is found by its
  // order in `byOrder`, never by its position.
  let events: StoredEvent[] = commits.flatMap((commit) => commit.events)
  const byOrder = new Map(events.map((event) => [event.order, event]))
  // The highest order the log ever assigned, which a purge never lowers, and
  // the highest order a purge removed, by Event type.
  let version = opened.version
  const purgedThrough = new Map(Object.entries(opened.purged))
  const commitsByIdempotencyKey = new Map<string, StoredCommit>()
  // The IDs Events are stored under, and the orders of the Events carrying
  // each key, in log order.
  const ids = new Set<string>()
  const ordersByKey = new Map<string, number[]>()
  const index = (commit: StoredCommit) => {
    if (commit.idempotencyKey) {
      commitsByIdempotencyKey.set(commit.idempotencyKey, commit)
    }
    for (const event of commit.events) {
      ids.add(event.id)
      for (const [name, value] of Object.entries(event.keys ?? {})) {
        const key = keyOf(name, value)
        const orders = ordersByKey.get(key)
        if (orders) orders.push(event.order)
        else ordersByKey.set(key, [event.order])
      }
    }
  }
  for (const commit of commits) index(commit)
  // A stored Event as the Event Log returns it, with the keys it was
  // appended with.
  const copyEvent = (event: StoredEvent): PersistedEvent => ({
    id: event.id,
    order: event.order,
    type: event.type,
    payload: event.payload,
    recordedAt: event.recordedAt,
    keys: { ...event.keys },
  })
  // Whether a stored Event is one the condition's decision read.
  const read = (event: StoredEvent, condition: EventLogAppendCondition) => {
    if (!condition.eventTypes.includes(event.type)) return false
    if (!condition.keys) return true
    const carried = event.keys ?? {}
    return Object.entries(condition.keys).some(
      ([name, values]) =>
        Object.hasOwn(carried, name) &&
        values.includes(carried[name] as string),
    )
  }
  const copyCommit = (commit: StoredCommit): EventLogCommit => ({
    ...commit,
    events: commit.events.map(copyEvent),
  })
  // The position of the first Event with an order above `afterOrder`.
  const firstAfter = (afterOrder: number) => {
    let low = 0
    let high = events.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if ((events[middle] as StoredEvent).order > afterOrder) high = middle
      else low = middle + 1
    }
    return low
  }

  function append(
    drafts: readonly EventLogDraft[],
    appendOptions: EventLogAppendOptions = {},
  ): EventLogAppendResult {
    if (poisoned) throw poisoned
    if (fd === undefined) throw new Error('JSONL Event Log is closed')
    const existing = appendOptions.idempotencyKey
      ? commitsByIdempotencyKey.get(appendOptions.idempotencyKey)
      : undefined
    if (existing) {
      return { ...copyCommit(existing), duplicate: true }
    }
    if (drafts.length === 0) {
      throw new Error('Event Log append requires at least one Event')
    }
    if (
      appendOptions.expectedVersion !== undefined &&
      appendOptions.expectedVersion !== version
    ) {
      throw new SpecterVersionConflictError(
        appendOptions.expectedVersion,
        version,
      )
    }
    const unchanged = appendOptions.expectedUnchanged
    if (unchanged && !matchesNothing(unchanged)) {
      for (let index = events.length - 1; index >= 0; index--) {
        const event = events[index] as StoredEvent
        if (event.order <= unchanged.afterOrder) break
        if (read(event, unchanged)) {
          throw new SpecterVersionConflictError(
            unchanged.afterOrder,
            event.order,
          )
        }
      }
      // A purge removed an Event of the condition's types after its read:
      // stale whatever the Event's keys were.
      for (const type of unchanged.eventTypes) {
        const purged = purgedThrough.get(type) ?? 0
        if (purged > unchanged.afterOrder) {
          throw new SpecterVersionConflictError(unchanged.afterOrder, purged)
        }
      }
    }
    // The host's ID and time when it supplied them.
    const stored = drafts.map((draft, index) => ({
      id: draft.id ?? eventId(),
      order: version + index + 1,
      type: draft.type,
      payload: draft.payload,
      recordedAt: draft.recordedAt ?? now().toISOString(),
      ...(Object.keys(draft.keys).length > 0 ? { keys: draft.keys } : {}),
    }))
    const appended = new Set<string>()
    for (const event of stored) {
      if (ids.has(event.id) || appended.has(event.id)) {
        throw new Error(`Event ID "${event.id}" is in the log already`)
      }
      if (Number.isNaN(Date.parse(event.recordedAt))) {
        throw new Error('Event recordedAt must be an ISO-8601 timestamp')
      }
      appended.add(event.id)
    }
    const line = JSON.stringify({
      version: version + drafts.length,
      committedAt: now().toISOString(),
      idempotencyKey: appendOptions.idempotencyKey,
      fingerprint: appendOptions.fingerprint,
      events: stored,
    })
    // Index the decoded line so live reads match what a reopen returns.
    const commit = parseCommit(line, version, false)
    // JSON.stringify drops a payload it cannot represent, such as a function.
    if (commit.events.some((event) => !('payload' in event))) {
      throw new Error('JSONL Event payload must be JSON-serializable')
    }
    const bytes = Buffer.from(`${line}\n`)
    try {
      writeAll(fd, bytes)
      if (options.fsync) fsyncSync(fd)
    } catch (cause) {
      // Drop a partial line so the next append starts on a line boundary.
      try {
        ftruncateSync(fd, committedBytes)
      } catch (truncateCause) {
        // A partial line may remain, so no further append may reuse its
        // orders. Reopening removes or keeps the line as recovery does.
        poisoned = new AggregateError(
          [cause, truncateCause],
          'JSONL Event Log write failed and the partial line could not be removed; close and reopen the log',
        )
        closeQuietly(fd)
        fd = undefined
        throw poisoned
      }
      throw cause
    }
    committedBytes += bytes.length
    events.push(...commit.events)
    for (const event of commit.events) byOrder.set(event.order, event)
    commits.push(commit)
    version = commit.version
    index(commit)
    return { ...copyCommit(commit), duplicate: false }
  }

  function purge(name: string, value: string, keep: readonly string[]) {
    if (poisoned) throw poisoned
    if (fd === undefined) throw new Error('JSONL Event Log is closed')
    const kept = new Set(keep)
    const removed = new Set(
      (ordersByKey.get(keyOf(name, value)) ?? []).filter(
        (order) => !kept.has((byOrder.get(order) as StoredEvent).type),
      ),
    )
    if (removed.size === 0) return { purged: 0 }
    const purged = new Map(purgedThrough)
    for (const order of removed) {
      const type = (byOrder.get(order) as StoredEvent).type
      purged.set(type, Math.max(purged.get(type) ?? 0, order))
    }
    // A commit keeps the Events it has left; one left with none goes, with
    // its idempotency receipt.
    const left = commits.flatMap((commit): StoredCommit[] => {
      if (!commit.events.some((event) => removed.has(event.order))) {
        return [commit]
      }
      const events = commit.events.filter((event) => !removed.has(event.order))
      return events.length === 0 ? [] : [{ ...commit, events }]
    })
    const content = Buffer.from(
      [
        JSON.stringify({ purged: Object.fromEntries(purged), version }),
        ...left.map((commit) =>
          JSON.stringify({
            version: commit.version,
            committedAt: commit.committedAt,
            idempotencyKey: commit.idempotencyKey,
            fingerprint: commit.fingerprint,
            events: commit.events,
          }),
        ),
      ]
        .map((line) => `${line}\n`)
        .join(''),
    )
    // The rewrite replaces the file whole or not at all.
    const path = resolve(options.path)
    const temporary = `${path}.purge`
    const written = openSync(temporary, 'w')
    try {
      writeAll(written, content)
      if (options.fsync) fsyncSync(written)
    } catch (cause) {
      closeQuietly(written)
      try {
        unlinkSync(temporary)
      } catch {}
      throw cause
    }
    closeSync(written)
    renameSync(temporary, path)
    if (options.fsync) fsyncDirectory(dirname(path))
    closeQuietly(fd)
    try {
      fd = openSync(path, 'a')
    } catch (cause) {
      fd = undefined
      poisoned = new AggregateError(
        [cause],
        'JSONL Event Log could not reopen its file after a purge; close and reopen the log',
      )
      throw poisoned
    }
    committedBytes = content.length
    for (const order of removed) {
      const event = byOrder.get(order) as StoredEvent
      byOrder.delete(order)
      ids.delete(event.id)
      for (const [keyName, keyValue] of Object.entries(event.keys ?? {})) {
        const indexed = keyOf(keyName, keyValue)
        const others = (ordersByKey.get(indexed) ?? []).filter(
          (other) => other !== order,
        )
        if (others.length > 0) ordersByKey.set(indexed, others)
        else ordersByKey.delete(indexed)
      }
    }
    for (const [type, order] of purged) purgedThrough.set(type, order)
    events = events.filter((event) => !removed.has(event.order))
    commits = left
    commitsByIdempotencyKey.clear()
    for (const commit of commits) {
      if (commit.idempotencyKey) {
        commitsByIdempotencyKey.set(commit.idempotencyKey, commit)
      }
    }
    return { purged: removed.size }
  }

  const eventLog: JsonlEventLog = {
    capabilities: { scopedAppend: true, keyedRead: true, purge: true },
    path: options.path,
    discardedTrailingBytes,
    recoveredStaleLock,
    query: (afterOrder, eventTypes, page = {}) =>
      Effect.sync(() =>
        events
          // Events are ordered, so slicing skips the earlier ones; the
          // filter keeps `order > afterOrder` exact, including for NaN.
          .slice(firstAfter(afterOrder))
          .filter(
            (event) =>
              event.order > afterOrder && eventTypes.includes(event.type),
          )
          .slice(0, page.limit)
          .map(copyEvent),
      ),
    currentVersion: Effect.sync(() => version),
    readKey: (key, page = {}) =>
      Effect.sync(() => {
        const afterOrder = page.afterOrder ?? 0
        return (ordersByKey.get(keyOf(key.name, key.value)) ?? [])
          .filter((order) => order > afterOrder)
          .slice(0, page.limit ?? Number.POSITIVE_INFINITY)
          .map((order) => copyEvent(byOrder.get(order) as StoredEvent))
      }),
    commitsAfter: (afterVersion, page = {}) =>
      Effect.sync(() =>
        commits
          .filter((commit) => commit.version > afterVersion)
          .slice(0, page.limit)
          .map(copyCommit),
      ),
    findCommit: (key) =>
      Effect.sync(() => {
        const commit = commitsByIdempotencyKey.get(key)
        return commit ? copyCommit(commit) : undefined
      }),
    // `append` is synchronous, so appends cannot interleave and need no lock.
    append: (drafts, appendOptions) =>
      Effect.try({
        try: () => append(drafts, appendOptions),
        catch: (cause) => new EventLogFailure('append', cause),
      }),
    // Synchronous like `append`, so the two never interleave.
    purge: (key, purgeOptions = {}) =>
      Effect.try({
        try: () => purge(key.name, key.value, purgeOptions.keep ?? []),
        catch: (cause) => new EventLogFailure('purge', cause),
      }),
    close: () => {
      if (closed) return
      closed = true
      try {
        if (fd !== undefined) closeSync(fd)
      } finally {
        fd = undefined
        releaseLock()
      }
    },
  }
  if (options.onOpen) {
    try {
      options.onOpen({ recoveredStaleLock, discardedTrailingBytes })
    } catch (cause) {
      eventLog.close()
      throw cause
    }
  }
  return eventLog
}

/**
 * Scoped Layer: opens the file on acquire and closes it on release. An open
 * failure is a defect, like the other file-backed adapter Layers, so the Layer
 * fits `createSpecterApp`. The Layer provides only `EventLog`; pass `onOpen`
 * to observe `recoveredStaleLock` and `discardedTrailingBytes`.
 */
export function createJsonlEventLogLayer(
  options: JsonlEventLogOptions,
): Layer.Layer<EventLog> {
  return Layer.effect(
    EventLog,
    Effect.acquireRelease(
      Effect.sync(() => createJsonlEventLog(options)),
      (eventLog) => Effect.sync(() => eventLog.close()),
    ),
  )
}

/**
 * An Event as a commit line stores it: with the keys it was appended with,
 * omitted when it has none.
 */
type StoredEvent = Omit<PersistedEvent, 'keys'> & {
  readonly keys?: Readonly<Record<string, string>>
}

type StoredCommit = Omit<EventLogCommit, 'events'> & {
  readonly events: readonly StoredEvent[]
}

// Names cannot contain a NUL, so a name and value join unambiguously.
const keyOf = (name: string, value: string) => `${name}\u0000${value}`

/** A condition whose keys list no value: no Event matches it. */
const matchesNothing = (condition: EventLogAppendCondition) =>
  condition.keys !== undefined &&
  Object.values(condition.keys).every((values) => values.length === 0)

/**
 * The first line of a file a purge rewrote: the highest order the log
 * assigned, and by Event type the highest order a purge removed.
 */
type PurgeHeader = {
  readonly purged: Readonly<Record<string, number>>
  readonly version: number
}

const headerPrefix = '{"purged":'

function parseHeader(line: string): PurgeHeader {
  const header = JSON.parse(line) as PurgeHeader
  if (
    typeof header !== 'object' ||
    header === null ||
    typeof header.purged !== 'object' ||
    header.purged === null ||
    !Object.values(header.purged).every(
      (order) => Number.isSafeInteger(order) && order > 0,
    ) ||
    !Number.isSafeInteger(header.version) ||
    header.version < 0
  ) {
    throw new Error('JSONL Event Log purge record is malformed')
  }
  return header
}

function openFile(path: string, fsync: boolean) {
  let content: Buffer
  try {
    content = readFileSync(path)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
    content = Buffer.alloc(0)
  }
  const complete = content.lastIndexOf(0x0a) + 1
  const commits: StoredCommit[] = []
  let header: PurgeHeader | undefined
  let version = 0
  for (const [index, line] of content
    .subarray(0, complete)
    .toString('utf8')
    .split('\n')
    .entries()) {
    if (!line) continue
    // Only a purge writes this line, first, in a file it renames into place.
    if (index === 0 && line.startsWith(headerPrefix)) {
      header = parseHeader(line)
      continue
    }
    const commit = parseCommit(line, version, header !== undefined)
    commits.push(commit)
    version = commit.version
  }
  // Every complete line is valid, so the file is a log. Appends write
  // `line\n` in one call; bytes after the last newline are either a whole
  // commit whose newline was lost, or a write interrupted by a crash that no
  // caller saw succeed.
  const tail = content.subarray(complete).toString('utf8')
  let size = complete
  let discardedTrailingBytes = 0
  let terminateTail = false
  if (tail && parsesAsJson(tail)) {
    const commit = parseCommit(tail, version, header !== undefined)
    commits.push(commit)
    version = commit.version
    size = content.length + 1
    terminateTail = true
  } else if (tail && isTornCommit(tail)) {
    discardedTrailingBytes = content.length - complete
  } else if (tail) {
    throw new Error(
      `JSONL Event Log ${path} ends with a line that is not a commit`,
    )
  }
  if (discardedTrailingBytes > 0) truncateSync(path, complete)
  const fd = openSync(path, 'a')
  if (terminateTail) {
    try {
      writeAll(fd, Buffer.from('\n'))
      if (fsync) fsyncSync(fd)
    } catch (cause) {
      closeQuietly(fd)
      throw cause
    }
  }
  return {
    commits,
    size,
    discardedTrailingBytes,
    fd,
    version: Math.max(version, header?.version ?? 0),
    purged: header?.purged ?? {},
  }
}

const commitPrefix = '{"version":'

function validKeys(keys: unknown) {
  return (
    keys === undefined ||
    (typeof keys === 'object' &&
      keys !== null &&
      !Array.isArray(keys) &&
      Object.values(keys).every((value) => typeof value === 'string'))
  )
}

function parsesAsJson(text: string) {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

function isTornCommit(tail: string) {
  return tail.startsWith(commitPrefix) || commitPrefix.startsWith(tail)
}

/**
 * A commit line, after the commit of `previousVersion`. Its Events' orders
 * follow on from it; in a file a purge rewrote (`purged`), they only
 * ascend, since a purge leaves gaps, and the commit keeps its version.
 */
function parseCommit(
  line: string,
  previousVersion: number,
  purged: boolean,
): StoredCommit {
  const record = JSON.parse(line) as StoredCommit
  const wellFormed =
    typeof record === 'object' &&
    record !== null &&
    Array.isArray(record.events) &&
    record.events.length > 0 &&
    record.events.every((event) => validKeys(event.keys)) &&
    (purged
      ? record.events.every(
          (event, index) =>
            Number.isSafeInteger(event.order) &&
            event.order >
              (index === 0
                ? previousVersion
                : (record.events[index - 1] as StoredEvent).order),
        ) &&
        Number.isSafeInteger(record.version) &&
        record.version >= (record.events.at(-1) as StoredEvent).order
      : record.events.every(
          (event, index) => event.order === previousVersion + index + 1,
        ) && record.version === previousVersion + record.events.length)
  if (!wellFormed || Number.isNaN(Date.parse(record.committedAt))) {
    throw new Error(
      `JSONL Event Log commit after version ${previousVersion} is malformed`,
    )
  }
  return record
}

function fsyncDirectory(directory: string) {
  const fd = openSync(directory, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}
