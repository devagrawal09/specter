import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EventLogFailure } from '@specter-ts/core'
import { Effect } from 'effect'
import { afterEach, expect, it, vi } from 'vitest'

import { createJsonlEventLog } from './event-log'

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

function temporaryLogPath() {
  const directory = mkdtempSync(join(tmpdir(), 'specter-jsonl-failure-'))
  directories.push(directory)
  return join(directory, 'events.jsonl')
}

afterEach(() => {
  failures.write = false
  failures.truncate = false
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

const appendTodo = (
  eventLog: ReturnType<typeof createJsonlEventLog>,
  todoId: string,
) =>
  Effect.runPromise(
    Effect.result(
      eventLog.append([{ type: 'todo-added', payload: { todoId } }]),
    ),
  )

it('removes the partial line when a write fails', async () => {
  const path = temporaryLogPath()
  const eventLog = createJsonlEventLog({ path })
  await appendTodo(eventLog, 'todo-1')
  const before = readFileSync(path, 'utf8')

  failures.write = true
  const failed = await appendTodo(eventLog, 'todo-2')
  failures.write = false
  expect(failed._tag).toBe('Failure')
  expect(readFileSync(path, 'utf8')).toBe(before)
  expect(await Effect.runPromise(eventLog.currentVersion)).toBe(1)

  const next = await appendTodo(eventLog, 'todo-3')
  expect(next._tag === 'Success' && next.success.events[0]?.order).toBe(2)
  eventLog.close()
  const reopened = createJsonlEventLog({ path })
  expect(reopened.discardedTrailingBytes).toBe(0)
  expect(await Effect.runPromise(reopened.currentVersion)).toBe(2)
  reopened.close()
})

it('refuses further appends when the partial line cannot be removed', async () => {
  const path = temporaryLogPath()
  const eventLog = createJsonlEventLog({ path })
  await appendTodo(eventLog, 'todo-1')

  failures.write = true
  failures.truncate = true
  const failed = await appendTodo(eventLog, 'todo-2')
  failures.write = false
  failures.truncate = false
  expect(failed._tag).toBe('Failure')
  if (failed._tag === 'Failure') {
    expect(failed.failure).toBeInstanceOf(EventLogFailure)
    expect(failed.failure.operation).toBe('append')
    const cause = failed.failure.cause as AggregateError
    expect(cause).toBeInstanceOf(AggregateError)
    expect(cause.errors.map((error: Error) => error.message)).toEqual([
      'ENOSPC: no space left',
      'EIO: truncate failed',
    ])
  }
  const later = await appendTodo(eventLog, 'todo-3')
  expect(later._tag === 'Failure' && later.failure.cause).toBe(
    failed._tag === 'Failure' ? failed.failure.cause : undefined,
  )
  eventLog.close()

  // Reopening drops the torn line and continues after the last commit.
  const reopened = createJsonlEventLog({ path })
  expect(reopened.discardedTrailingBytes).toBeGreaterThan(0)
  expect(await Effect.runPromise(reopened.currentVersion)).toBe(1)
  const next = await appendTodo(reopened, 'todo-4')
  expect(next._tag === 'Success' && next.success.events[0]?.order).toBe(2)
  reopened.close()
})
