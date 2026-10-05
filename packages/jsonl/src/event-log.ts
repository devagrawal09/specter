import { randomUUID } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readFileSync,
  truncateSync,
  writeSync,
} from 'node:fs'
import { dirname } from 'node:path'

import {
  EventLog,
  EventLogFailure,
  SpecterIdempotencyConflictError,
  SpecterVersionConflictError,
  type EventDraft,
  type EventLogAppendOptions,
  type EventLogAppendResult,
  type EventLogCommit,
  type EventLogService,
  type PersistedEvent,
} from '@specter-ts/core'
import { Effect, Layer, Semaphore } from 'effect'

export type JsonlEventLogOptions = {
  readonly path: string
  /** Call `fsync` after every append. Off by default. */
  readonly fsync?: boolean
  readonly eventId?: () => string
  readonly now?: () => Date
}

export type JsonlEventLog = EventLogService & {
  readonly path: string
  /** Bytes of an unterminated trailing line removed while opening. */
  readonly discardedTrailingBytes: number
  readonly close: () => void
}

/**
 * Opens one append-only JSONL file as an Event Log. Each line is one complete
 * commit, so a line boundary is the atomic commit boundary. The process that
 * opens the file must be its only writer.
 */
export function createJsonlEventLog(
  options: JsonlEventLogOptions,
): JsonlEventLog {
  const eventId = options.eventId ?? randomUUID
  const now = options.now ?? (() => new Date())
  const { commits, size, discardedTrailingBytes } = readCommits(options.path)
  let committedBytes = size
  const events: PersistedEvent[] = commits.flatMap((commit) => commit.events)
  const commitsByIdempotencyKey = new Map<string, EventLogCommit>()
  for (const commit of commits) {
    if (commit.idempotencyKey) {
      commitsByIdempotencyKey.set(commit.idempotencyKey, commit)
    }
  }
  let fd: number | undefined = openSync(options.path, 'a')
  const semaphore = Semaphore.makeUnsafe(1)
  const copyEvent = (event: PersistedEvent): PersistedEvent => ({ ...event })
  const copyCommit = (commit: EventLogCommit): EventLogCommit => ({
    ...commit,
    events: commit.events.map(copyEvent),
  })

  function append(
    drafts: readonly EventDraft[],
    appendOptions: EventLogAppendOptions = {},
  ): EventLogAppendResult {
    if (fd === undefined) throw new Error('JSONL Event Log is closed')
    const existing = appendOptions.idempotencyKey
      ? commitsByIdempotencyKey.get(appendOptions.idempotencyKey)
      : undefined
    if (existing) {
      if (existing.fingerprint !== appendOptions.fingerprint) {
        throw new SpecterIdempotencyConflictError(
          appendOptions.idempotencyKey as string,
        )
      }
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
    const persisted = drafts.map((draft, index) => {
      if (JSON.stringify(draft.payload) === undefined) {
        throw new Error('JSONL Event payload must be JSON-serializable')
      }
      return {
        id: eventId(),
        order: version + index + 1,
        type: draft.type,
        payload: draft.payload,
        recordedAt: now().toISOString(),
      }
    })
    const line = JSON.stringify({
      version: version + persisted.length,
      committedAt: now().toISOString(),
      idempotencyKey: appendOptions.idempotencyKey,
      fingerprint: appendOptions.fingerprint,
      events: persisted,
    })
    const bytes = Buffer.from(`${line}\n`)
    try {
      writeAll(fd, bytes)
      if (options.fsync) fsyncSync(fd)
    } catch (cause) {
      // Drop a partial line so the next append starts on a line boundary.
      ftruncateSync(fd, committedBytes)
      throw cause
    }
    committedBytes += bytes.length
    // Index the decoded line so live reads match what a reopen returns.
    const commit = parseCommit(line, version)
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
    query: (afterOrder, eventTypes) =>
      Effect.sync(() =>
        events
          .slice(Math.max(0, afterOrder))
          .filter((event) => eventTypes.includes(event.type))
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
    append: (drafts, appendOptions) =>
      semaphore.withPermit(
        Effect.try({
          try: () => append(drafts, appendOptions),
          catch: (cause) => new EventLogFailure('append', cause),
        }),
      ),
    close: () => {
      if (fd === undefined) return
      closeSync(fd)
      fd = undefined
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

function readCommits(path: string) {
  mkdirSync(dirname(path), { recursive: true })
  let content: Buffer
  try {
    content = readFileSync(path)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      return { commits: [], size: 0, discardedTrailingBytes: 0 }
    }
    throw cause
  }
  // Appends write `line\n` in one call. Bytes after the last newline are a
  // write interrupted by a crash; no caller saw that commit succeed.
  const complete = content.lastIndexOf(0x0a) + 1
  const discardedTrailingBytes = content.length - complete
  if (discardedTrailingBytes > 0) truncateSync(path, complete)
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
  return { commits, size: complete, discardedTrailingBytes }
}

function parseCommit(line: string, previousVersion: number): EventLogCommit {
  const record = JSON.parse(line) as EventLogCommit
  const contiguous =
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

function writeAll(fd: number, buffer: Buffer) {
  let offset = 0
  while (offset < buffer.length) {
    offset += writeSync(fd, buffer, offset)
  }
}
