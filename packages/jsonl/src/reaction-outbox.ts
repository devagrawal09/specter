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
  ReactionOutboxLeaseLostError,
  type EnqueueReactionInput,
  type EnqueueReactionResult,
  type ReactionOutboxClaim,
  type ReactionOutboxJob,
  type ReactionOutboxStatus,
  type ReactionOutboxStore,
} from '@specter-ts/reaction-outbox'
import { Effect } from 'effect'

import { acquireLock, closeQuietly, writeAll } from './file-lock'

export type JsonlReactionOutboxCodec<TPayload> = {
  /** Returns the JSON-serializable value written to the `enqueued` line. */
  readonly encode: (payload: TPayload) => unknown
  readonly decode: (encoded: unknown) => TPayload
}

export type JsonlReactionOutboxStoreOptions<TPayload = unknown> = {
  readonly path: string
  /** Call `fsync` after every transition. Off by default. */
  readonly fsync?: boolean
  readonly codec?: JsonlReactionOutboxCodec<TPayload>
  /** Clock used to release attempts a previous open left running. */
  readonly now?: () => Date
}

export type JsonlReactionOutboxStore<TPayload = unknown> =
  ReactionOutboxStore<TPayload> &
    Required<
      Pick<ReactionOutboxStore<TPayload>, 'renewLease' | 'subscribe'>
    > & {
      readonly path: string
      /** Bytes of an interrupted trailing write removed while opening. */
      readonly discardedTrailingBytes: number
      /** Jobs a previous open left running, made claimable again on open. */
      readonly releasedOnOpen: readonly string[]
      readonly close: () => void
    }

/** One line of the journal: a job transition. */
type OutboxRecord =
  | {
      readonly type: 'enqueued'
      readonly id: string
      readonly idempotencyKey: string
      readonly payload: unknown
      readonly requestedAt: string
      readonly availableAt: string
    }
  | {
      readonly type: 'claimed'
      readonly id: string
      readonly attemptId: string
      readonly attemptCount: number
      readonly leaseExpiresAt: string
    }
  | {
      readonly type: 'renewed'
      readonly id: string
      readonly attemptId: string
      readonly leaseExpiresAt: string
    }
  | {
      readonly type: 'completed'
      readonly id: string
      readonly attemptId: string
      readonly completedAt: string
    }
  | {
      readonly type: 'failed'
      readonly id: string
      readonly attemptId: string
      readonly availableAt: string
      readonly error: string
    }
  | {
      readonly type: 'dead-lettered'
      readonly id: string
      readonly attemptId: string
      readonly failedAt: string
      readonly error: string
    }
  | {
      readonly type: 'released'
      readonly id: string
      readonly attemptId: string
      readonly availableAt: string
      readonly error: string
    }
  | {
      readonly type: 'retried'
      readonly id: string
      readonly availableAt: string
    }

const recordFields: Record<
  OutboxRecord['type'],
  Record<string, 'string' | 'date' | 'count'>
> = {
  enqueued: {
    idempotencyKey: 'string',
    requestedAt: 'date',
    availableAt: 'date',
  },
  claimed: {
    attemptId: 'string',
    attemptCount: 'count',
    leaseExpiresAt: 'date',
  },
  renewed: { attemptId: 'string', leaseExpiresAt: 'date' },
  completed: { attemptId: 'string', completedAt: 'date' },
  failed: { attemptId: 'string', availableAt: 'date', error: 'string' },
  'dead-lettered': { attemptId: 'string', failedAt: 'date', error: 'string' },
  released: { attemptId: 'string', availableAt: 'date', error: 'string' },
  retried: { availableAt: 'date' },
}

/** A job as indexed in memory; the payload stays encoded JSON text. */
type Entry = Omit<ReactionOutboxJob, 'payload'> & { readonly payload: string }

const leaseExpiredError = 'Reaction attempt lease expired'
const reopenedError =
  'Reaction attempt interrupted: the outbox was closed or its process exited while the attempt ran'

/**
 * Opens one append-only JSONL file as a Reaction outbox Store. Each line is
 * one job transition, and opening replays the lines into an in-memory index.
 * Opening takes an exclusive `<path>.lock` file, released by `close()`, so
 * the opener is the file's only writer; attempts an earlier open left running
 * are released for a new attempt at once.
 */
export function createJsonlReactionOutboxStore<TPayload = unknown>(
  options: JsonlReactionOutboxStoreOptions<TPayload>,
): JsonlReactionOutboxStore<TPayload> {
  const path = options.path
  const now = options.now ?? (() => new Date())
  const codec: JsonlReactionOutboxCodec<TPayload> = options.codec ?? {
    encode: (payload) => payload,
    decode: (encoded) => encoded as TPayload,
  }
  const jobs = new Map<string, Entry>()
  const idsByIdempotencyKey = new Map<string, string>()
  const listeners = new Set<() => void>()
  const releaseLock = acquireLock(resolve(path), 'JSONL Reaction outbox')
  let fd: number | undefined
  let committedBytes = 0
  let discardedTrailingBytes = 0
  let closed = false
  /** Set when a failed write could not be undone; every later write fails. */
  let poisoned: AggregateError | undefined
  const releasedOnOpen: string[] = []

  function apply(record: OutboxRecord) {
    if (record.type === 'enqueued') {
      if (
        jobs.has(record.id) ||
        idsByIdempotencyKey.has(record.idempotencyKey)
      ) {
        throw new Error(`job ${record.id} is enqueued twice`)
      }
      jobs.set(record.id, {
        id: record.id,
        idempotencyKey: record.idempotencyKey,
        payload: JSON.stringify(record.payload),
        status: 'pending',
        requestedAt: new Date(record.requestedAt),
        availableAt: new Date(record.availableAt),
        attemptCount: 0,
      })
      idsByIdempotencyKey.set(record.idempotencyKey, record.id)
      return
    }
    const job = jobs.get(record.id)
    if (!job) throw new Error(`job ${record.id} is not enqueued`)
    if (record.type === 'claimed') {
      if (
        job.status !== 'pending' ||
        record.attemptCount !== job.attemptCount + 1
      ) {
        throw new Error(
          `job ${record.id} cannot start attempt ${record.attemptId}`,
        )
      }
      jobs.set(record.id, {
        ...job,
        status: 'running',
        attemptCount: record.attemptCount,
        activeAttemptId: record.attemptId,
        leaseExpiresAt: new Date(record.leaseExpiresAt),
        completedAt: undefined,
      })
      return
    }
    if (record.type === 'retried') {
      if (job.status !== 'dead-letter') {
        throw new Error(`job ${record.id} is not dead-lettered`)
      }
      jobs.set(record.id, {
        ...job,
        status: 'pending',
        availableAt: new Date(record.availableAt),
        completedAt: undefined,
        lastError: undefined,
      })
      return
    }
    if (job.status !== 'running' || job.activeAttemptId !== record.attemptId) {
      throw new Error(`attempt ${record.attemptId} is not active`)
    }
    const settled = {
      ...job,
      activeAttemptId: undefined,
      leaseExpiresAt: undefined,
    }
    switch (record.type) {
      case 'renewed':
        jobs.set(record.id, {
          ...job,
          leaseExpiresAt: new Date(record.leaseExpiresAt),
        })
        return
      case 'completed':
        jobs.set(record.id, {
          ...settled,
          status: 'completed',
          completedAt: new Date(record.completedAt),
          lastError: undefined,
        })
        return
      case 'failed':
      case 'released':
        jobs.set(record.id, {
          ...settled,
          status: 'pending',
          availableAt: new Date(record.availableAt),
          lastError: record.error,
        })
        return
      case 'dead-lettered':
        jobs.set(record.id, {
          ...settled,
          status: 'dead-letter',
          completedAt: new Date(record.failedAt),
          lastError: record.error,
        })
        return
    }
  }

  function replay(text: string, lineNumber: number) {
    try {
      apply(parseRecord(text))
    } catch (cause) {
      throw new Error(
        `JSONL Reaction outbox ${path} line ${lineNumber} is malformed: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      )
    }
  }

  /** Writes the records as lines, then applies them to the index. */
  function commit(records: readonly OutboxRecord[]) {
    if (poisoned) throw poisoned
    if (fd === undefined)
      throw new Error(`JSONL Reaction outbox ${path} is closed`)
    const lines = records.map((record) => JSON.stringify(record))
    // Index the decoded lines so live reads match what a reopen returns.
    const decoded = lines.map(parseRecord)
    const bytes = Buffer.from(lines.map((line) => `${line}\n`).join(''))
    try {
      writeAll(fd, bytes)
      if (options.fsync) fsyncSync(fd)
    } catch (cause) {
      // Drop a partial line so the next write starts on a line boundary.
      try {
        ftruncateSync(fd, committedBytes)
      } catch (truncateCause) {
        poisoned = new AggregateError(
          [cause, truncateCause],
          'JSONL Reaction outbox write failed and the partial line could not be removed; close and reopen the outbox',
        )
        closeQuietly(fd)
        fd = undefined
        throw poisoned
      }
      throw cause
    }
    committedBytes += bytes.length
    for (const record of decoded) apply(record)
  }

  function toJob(entry: Entry): ReactionOutboxJob<TPayload> {
    return {
      ...entry,
      payload: codec.decode(JSON.parse(entry.payload)),
      requestedAt: new Date(entry.requestedAt),
      availableAt: new Date(entry.availableAt),
      leaseExpiresAt: entry.leaseExpiresAt
        ? new Date(entry.leaseExpiresAt)
        : undefined,
      completedAt: entry.completedAt ? new Date(entry.completedAt) : undefined,
    }
  }

  function requireActiveAttempt(jobId: string, attemptId: string) {
    const job = jobs.get(jobId)
    if (job?.status !== 'running' || job.activeAttemptId !== attemptId) {
      throw new ReactionOutboxLeaseLostError(attemptId)
    }
    return job
  }

  function notifyListeners() {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        // A wake-up is a hint; the job is already stored.
      }
    }
  }

  /** Store operations are synchronous, so they never interleave. */
  const run = <A>(operation: () => A): Effect.Effect<A, unknown> =>
    Effect.try({ try: operation, catch: (cause) => cause })

  try {
    let content: Buffer
    try {
      content = readFileSync(path)
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
      content = Buffer.alloc(0)
    }
    const complete = content.lastIndexOf(0x0a) + 1
    const lines = content.subarray(0, complete).toString('utf8').split('\n')
    lines.forEach((line, index) => {
      if (line) replay(line, index + 1)
    })
    // Bytes after the last newline are either a whole transition whose
    // newline was lost, or a write interrupted by a crash that no caller saw
    // succeed.
    const tail = content.subarray(complete).toString('utf8')
    let terminateTail = false
    committedBytes = complete
    if (tail && parsesAsJson(tail)) {
      replay(tail, lines.length)
      committedBytes = content.length + 1
      terminateTail = true
    } else if (tail && isTornRecord(tail)) {
      discardedTrailingBytes = content.length - complete
    } else if (tail) {
      throw new Error(
        `JSONL Reaction outbox ${path} ends with a line that is not a transition`,
      )
    }
    if (discardedTrailingBytes > 0) truncateSync(path, complete)
    fd = openSync(path, 'a')
    if (terminateTail) {
      writeAll(fd, Buffer.from('\n'))
      if (options.fsync) fsyncSync(fd)
    }
    // The lock makes this the only open of the file, so no attempt claimed
    // through an earlier open can still finish through it.
    const running = [...jobs.values()].filter((job) => job.status === 'running')
    if (running.length > 0) {
      const availableAt = now().toISOString()
      commit(
        running.map((job) => ({
          type: 'released' as const,
          id: job.id,
          attemptId: job.activeAttemptId as string,
          availableAt,
          error: reopenedError,
        })),
      )
      releasedOnOpen.push(...running.map((job) => job.id))
    }
  } catch (cause) {
    if (fd !== undefined) closeQuietly(fd)
    releaseLock()
    throw cause
  }

  return {
    path,
    discardedTrailingBytes,
    releasedOnOpen,

    enqueue(input: EnqueueReactionInput<TPayload>) {
      return run((): EnqueueReactionResult<TPayload> => {
        const existingId = idsByIdempotencyKey.get(input.idempotencyKey)
        const existing = existingId ? jobs.get(existingId) : undefined
        if (existing) return { job: toJob(existing), created: false }
        if (jobs.has(input.id)) {
          throw new Error(`Duplicate Reaction outbox job id: ${input.id}`)
        }
        const payload = codec.encode(input.payload)
        if (JSON.stringify(payload) === undefined) {
          throw new Error('Reaction outbox payload must be JSON-serializable')
        }
        commit([
          {
            type: 'enqueued',
            id: input.id,
            idempotencyKey: input.idempotencyKey,
            payload,
            requestedAt: input.requestedAt.toISOString(),
            availableAt: input.availableAt.toISOString(),
          },
        ])
        notifyListeners()
        return { job: toJob(jobs.get(input.id) as Entry), created: true }
      })
    },

    claimNext(at, leaseExpiresAt) {
      return run(() => {
        const job = [...jobs.values()]
          .filter(
            (candidate) =>
              candidate.status === 'pending' &&
              candidate.availableAt.getTime() <= at.getTime(),
          )
          .sort(
            (left, right) =>
              left.availableAt.getTime() - right.availableAt.getTime() ||
              left.requestedAt.getTime() - right.requestedAt.getTime() ||
              left.id.localeCompare(right.id),
          )[0]
        if (!job) return undefined
        const attemptCount = job.attemptCount + 1
        commit([
          {
            type: 'claimed',
            id: job.id,
            attemptId: `${job.id}:attempt:${attemptCount}`,
            attemptCount,
            leaseExpiresAt: leaseExpiresAt.toISOString(),
          },
        ])
        return toJob(jobs.get(job.id) as Entry) as ReactionOutboxClaim<TPayload>
      })
    },

    complete(jobId, attemptId, completedAt) {
      return run(() => {
        requireActiveAttempt(jobId, attemptId)
        commit([
          {
            type: 'completed',
            id: jobId,
            attemptId,
            completedAt: completedAt.toISOString(),
          },
        ])
      })
    },

    reschedule(jobId, attemptId, availableAt, error) {
      return run(() => {
        requireActiveAttempt(jobId, attemptId)
        commit([
          {
            type: 'failed',
            id: jobId,
            attemptId,
            availableAt: availableAt.toISOString(),
            error,
          },
        ])
      })
    },

    deadLetter(jobId, attemptId, failedAt, error) {
      return run(() => {
        requireActiveAttempt(jobId, attemptId)
        commit([
          {
            type: 'dead-lettered',
            id: jobId,
            attemptId,
            failedAt: failedAt.toISOString(),
            error,
          },
        ])
      })
    },

    renewLease(jobId, attemptId, leaseExpiresAt) {
      return run(() => {
        requireActiveAttempt(jobId, attemptId)
        commit([
          {
            type: 'renewed',
            id: jobId,
            attemptId,
            leaseExpiresAt: leaseExpiresAt.toISOString(),
          },
        ])
      })
    },

    requeueExpired(at) {
      return run(() => {
        const expired = [...jobs.values()].filter(
          (job) =>
            job.status === 'running' &&
            job.leaseExpiresAt !== undefined &&
            job.leaseExpiresAt.getTime() <= at.getTime(),
        )
        if (expired.length === 0) return 0
        commit(
          expired.map((job) => ({
            type: 'released' as const,
            id: job.id,
            attemptId: job.activeAttemptId as string,
            availableAt: at.toISOString(),
            error: leaseExpiredError,
          })),
        )
        return expired.length
      })
    },

    nextWorkAt() {
      return Effect.sync(() => {
        let next: Date | undefined
        for (const job of jobs.values()) {
          const wakeAt =
            job.status === 'pending'
              ? job.availableAt
              : job.status === 'running'
                ? job.leaseExpiresAt
                : undefined
          if (wakeAt && (!next || wakeAt.getTime() < next.getTime())) {
            next = wakeAt
          }
        }
        return next ? new Date(next) : undefined
      })
    },

    get(jobId) {
      return run(() => {
        const job = jobs.get(jobId)
        return job ? toJob(job) : undefined
      })
    },

    list(status?: ReactionOutboxStatus) {
      return run(() =>
        [...jobs.values()]
          .filter((job) => !status || job.status === status)
          .sort(
            (left, right) =>
              left.requestedAt.getTime() - right.requestedAt.getTime() ||
              left.id.localeCompare(right.id),
          )
          .map(toJob),
      )
    },

    retryDeadLetter(jobId, availableAt) {
      return run(() => {
        if (jobs.get(jobId)?.status !== 'dead-letter') {
          throw new Error(`Reaction outbox job is not dead-lettered: ${jobId}`)
        }
        commit([
          {
            type: 'retried',
            id: jobId,
            availableAt: availableAt.toISOString(),
          },
        ])
        notifyListeners()
      })
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    close() {
      if (closed) return
      closed = true
      listeners.clear()
      try {
        if (fd !== undefined) closeSync(fd)
      } finally {
        fd = undefined
        releaseLock()
      }
    },
  }
}

const recordPrefix = '{"type":"'

function parsesAsJson(text: string) {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

function isTornRecord(tail: string) {
  return tail.startsWith(recordPrefix) || recordPrefix.startsWith(tail)
}

function parseRecord(line: string): OutboxRecord {
  const record = JSON.parse(line) as Record<string, unknown> | null
  if (typeof record !== 'object' || record === null) {
    throw new Error('transition is not an object')
  }
  const type = record.type
  if (typeof type !== 'string' || !Object.hasOwn(recordFields, type)) {
    throw new Error(`unknown transition ${String(type)}`)
  }
  const fields = recordFields[type as OutboxRecord['type']]
  if (typeof record.id !== 'string') throw new Error('transition has no job id')
  for (const [field, kind] of Object.entries(fields)) {
    const value = record[field]
    const valid =
      kind === 'count'
        ? Number.isSafeInteger(value) && (value as number) > 0
        : typeof value === 'string' &&
          (kind === 'string' || !Number.isNaN(Date.parse(value)))
    if (!valid) throw new Error(`${type} transition has invalid ${field}`)
  }
  if (type === 'enqueued' && !('payload' in record)) {
    throw new Error('enqueued transition has no payload')
  }
  return record as OutboxRecord
}
