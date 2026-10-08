import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Effect } from 'effect'
import { afterEach, expect, it, vi } from 'vitest'

import { createJsonlReactionOutboxStore } from './reaction-outbox'

const failures = vi.hoisted(() => ({ write: false, truncate: false }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  let partialWritten = false
  return {
    ...actual,
    // Writes half of the line, then fails, like a full disk.
    writeSync: ((fd: number, buffer: Buffer, offset?: number | null) => {
      const start = offset ?? 0
      if (!failures.write) return actual.writeSync(fd, buffer, start)
      if (partialWritten) {
        partialWritten = false
        throw Object.assign(new Error('ENOSPC: no space left'), {
          code: 'ENOSPC',
        })
      }
      partialWritten = true
      const length = Math.floor((buffer.length - start) / 2)
      return actual.writeSync(fd, buffer, start, length)
    }) as typeof actual.writeSync,
    ftruncateSync: ((fd: number, length?: number) => {
      if (failures.truncate) throw new Error('EIO: truncate failed')
      return actual.ftruncateSync(fd, length)
    }) as typeof actual.ftruncateSync,
  }
})

const directories: string[] = []

function temporaryOutboxPath() {
  const directory = mkdtempSync(join(tmpdir(), 'specter-jsonl-outbox-failure-'))
  directories.push(directory)
  return join(directory, 'outbox.jsonl')
}

afterEach(() => {
  failures.write = false
  failures.truncate = false
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

const enqueue = (
  store: ReturnType<typeof createJsonlReactionOutboxStore>,
  id: string,
) =>
  Effect.runPromise(
    Effect.result(
      store.enqueue({
        id,
        idempotencyKey: id,
        payload: { id },
        requestedAt: new Date(0),
        availableAt: new Date(0),
      }),
    ),
  )

it('removes the partial line and indexes nothing when a write fails', async () => {
  const path = temporaryOutboxPath()
  const store = createJsonlReactionOutboxStore({ path })
  await enqueue(store, 'job-1')
  const before = readFileSync(path, 'utf8')

  failures.write = true
  const failed = await enqueue(store, 'job-2')
  failures.write = false

  expect(failed._tag).toBe('Failure')
  expect(readFileSync(path, 'utf8')).toBe(before)
  expect(await Effect.runPromise(store.get('job-2'))).toBeUndefined()
  // The failed enqueue left no idempotency record, so a retry creates it.
  const retried = await enqueue(store, 'job-2')
  expect(retried._tag === 'Success' && retried.success.created).toBe(true)
  store.close()
  const reopened = createJsonlReactionOutboxStore({ path })
  expect(reopened.discardedTrailingBytes).toBe(0)
  expect(await Effect.runPromise(reopened.list())).toHaveLength(2)
  reopened.close()
})

it('refuses further writes when the partial line cannot be removed', async () => {
  const path = temporaryOutboxPath()
  const store = createJsonlReactionOutboxStore({ path })
  await enqueue(store, 'job-1')

  failures.write = true
  failures.truncate = true
  const failed = await enqueue(store, 'job-2')
  failures.write = false
  failures.truncate = false

  expect(failed._tag).toBe('Failure')
  const cause = failed._tag === 'Failure' ? failed.failure : undefined
  expect(cause).toBeInstanceOf(AggregateError)
  expect(
    (cause as AggregateError).errors.map((error) => error.message),
  ).toEqual(['ENOSPC: no space left', 'EIO: truncate failed'])
  const later = await enqueue(store, 'job-3')
  expect(later._tag === 'Failure' && later.failure).toBe(cause)
  store.close()

  // Reopening drops the torn line and keeps the earlier job.
  const reopened = createJsonlReactionOutboxStore({ path })
  expect(reopened.discardedTrailingBytes).toBeGreaterThan(0)
  expect(
    (await Effect.runPromise(reopened.list())).map((job) => job.id),
  ).toEqual(['job-1'])
  reopened.close()
})
