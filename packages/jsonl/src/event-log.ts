import { randomUUID } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  ftruncateSync,
  openSync,
  readFileSync,
  truncateSync,
} from 'node:fs'
import { resolve } from 'node:path'

import {
  EventLog,
  EventLogFailure,
  SpecterVersionConflictError,
  type EventDraft,
  type EventLogAppendOptions,
  type EventLogAppendResult,
  type EventLogCommit,
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
 * commit, so a line boundary is the atomic commit boundary. Opening takes an
 * exclusive `<path>.lock` file, released by `close()`, so the opener is the
 * file's only writer; a lock left by an exited process on this host is taken
 * over and reported as `recoveredStaleLock`.
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
  const { commits, discardedTrailingBytes } = opened
  let fd: number | undefined = opened.fd
  let committedBytes = opened.size
  let closed = false
  /** Set when a failed write could not be undone; every later append fails. */
  let poisoned: AggregateError | undefined
  const events: PersistedEvent[] = commits.flatMap((commit) => commit.events)
  const commitsByIdempotencyKey = new Map<string, EventLogCommit>()
  for (const commit of commits) {
    if (commit.idempotencyKey) {
      commitsByIdempotencyKey.set(commit.idempotencyKey, commit)
    }
  }
  const copyEvent = (event: PersistedEvent): PersistedEvent => ({ ...event })
  const copyCommit = (commit: EventLogCommit): EventLogCommit => ({
    ...commit,
    events: commit.events.map(copyEvent),
  })

  function append(
    drafts: readonly EventDraft[],
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
    const version = events.length
    if (
      appendOptions.expectedVersion !== undefined &&
      appendOptions.expectedVersion !== version
    ) {
      throw new SpecterVersionConflictError(
        appendOptions.expectedVersion,
        version,
      )
    }
    const line = JSON.stringify({
      version: version + drafts.length,
      committedAt: now().toISOString(),
      idempotencyKey: appendOptions.idempotencyKey,
      fingerprint: appendOptions.fingerprint,
      events: drafts.map((draft, index) => ({
        id: eventId(),
        order: version + index + 1,
        type: draft.type,
        payload: draft.payload,
        recordedAt: now().toISOString(),
      })),
    })
    // Index the decoded line so live reads match what a reopen returns.
    const commit = parseCommit(line, version)
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
    commits.push(commit)
    if (commit.idempotencyKey) {
      commitsByIdempotencyKey.set(commit.idempotencyKey, commit)
    }
    return { ...copyCommit(commit), duplicate: false }
  }

  return {
    path: options.path,
    discardedTrailingBytes,
    recoveredStaleLock,
    query: (afterOrder, eventTypes) =>
      Effect.sync(() =>
        events
          // `order` is index + 1, so slicing skips most earlier Events; the
          // filter keeps `order > afterOrder` exact, including for NaN.
          .slice(Math.max(0, Math.floor(afterOrder) || 0))
          .filter(
            (event) =>
              event.order > afterOrder && eventTypes.includes(event.type),
          )
          .map(copyEvent),
      ),
    currentVersion: Effect.sync(() => events.length),
    commitsAfter: (afterVersion) =>
      Effect.sync(() =>
        commits
          .filter((commit) => commit.version > afterVersion)
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
}

/**
 * Scoped Layer: opens the file on acquire and closes it on release. An open
 * failure is a defect, like the other file-backed adapter Layers, so the Layer
 * fits `createSpecterApp`.
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

function openFile(path: string, fsync: boolean) {
  let content: Buffer
  try {
    content = readFileSync(path)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
    content = Buffer.alloc(0)
  }
  const complete = content.lastIndexOf(0x0a) + 1
  const commits: EventLogCommit[] = []
  let version = 0
  for (const line of content
    .subarray(0, complete)
    .toString('utf8')
    .split('\n')) {
    if (!line) continue
    const commit = parseCommit(line, version)
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
    commits.push(parseCommit(tail, version))
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
  return { commits, size, discardedTrailingBytes, fd }
}

const commitPrefix = '{"version":'

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

function parseCommit(line: string, previousVersion: number): EventLogCommit {
  const record = JSON.parse(line) as EventLogCommit
  const contiguous =
    typeof record === 'object' &&
    record !== null &&
    Array.isArray(record.events) &&
    record.events.length > 0 &&
    record.events.every(
      (event, index) => event.order === previousVersion + index + 1,
    ) &&
    record.version === previousVersion + record.events.length
  if (!contiguous || Number.isNaN(Date.parse(record.committedAt))) {
    throw new Error(
      `JSONL Event Log commit after version ${previousVersion} is malformed`,
    )
  }
  return record
}
