import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EventLog, SpecterVersionConflictError } from '@specter-ts/core'
import { testEventLogService } from '@specter-ts/core/testing'
import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'

import { createJsonlEventLog, createJsonlEventLogLayer } from './event-log'

const directories: string[] = []

function temporaryLogPath() {
  const directory = mkdtempSync(join(tmpdir(), 'specter-jsonl-'))
  directories.push(directory)
  return join(directory, 'nested', 'events.jsonl')
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

testEventLogService('jsonl', () =>
  createJsonlEventLog({ path: temporaryLogPath() }),
)

testEventLogService('jsonl with fsync', () =>
  createJsonlEventLog({ path: temporaryLogPath(), fsync: true }),
)

describe('JSONL Event Log', () => {
  it('reopens with identical version, commits, and queries', async () => {
    const path = temporaryLogPath()
    const first = createJsonlEventLog({ path })
    await Effect.runPromise(
      first.append(
        [
          { type: 'todo-added', payload: { todoId: 'todo-1' } },
          { type: 'todo-added', payload: { todoId: 'todo-2' } },
        ],
        { idempotencyKey: 'request-1', fingerprint: 'fingerprint-1' },
      ),
    )
    await Effect.runPromise(
      first.append([{ type: 'todo-removed', payload: { todoId: 'todo-1' } }]),
    )
    const snapshot = async (log: typeof first) => ({
      version: await Effect.runPromise(log.currentVersion),
      commits: await Effect.runPromise(log.commitsAfter(0)),
      query: await Effect.runPromise(
        log.query(1, ['todo-added', 'todo-removed']),
      ),
      receipt: await Effect.runPromise(log.findCommit('request-1')),
    })
    const before = await snapshot(first)
    first.close()

    const reopened = createJsonlEventLog({ path })
    expect(await snapshot(reopened)).toEqual(before)
    expect(before.version).toBe(3)
    const duplicate = await Effect.runPromise(
      reopened.append([{ type: 'ignored', payload: {} }], {
        idempotencyKey: 'request-1',
        fingerprint: 'fingerprint-1',
      }),
    )
    expect(duplicate).toEqual({ ...before.commits[0], duplicate: true })
    const next = await Effect.runPromise(
      reopened.append([{ type: 'todo-added', payload: { todoId: 'todo-3' } }], {
        expectedVersion: 3,
      }),
    )
    expect(next.events[0]?.order).toBe(4)
    reopened.close()
  })

  it('opens and closes the file with the Layer scope', async () => {
    const path = temporaryLogPath()
    await Effect.runPromise(
      Effect.gen(function* () {
        const eventLog = yield* EventLog
        yield* eventLog.append([{ type: 'todo-added', payload: {} }])
      }).pipe(Effect.provide(createJsonlEventLogLayer({ path }))),
    )
    const reopened = createJsonlEventLog({ path })
    expect(await Effect.runPromise(reopened.currentVersion)).toBe(1)
    reopened.close()
  })

  it('discards and reports a truncated trailing line on open', async () => {
    const path = temporaryLogPath()
    const first = createJsonlEventLog({ path })
    await Effect.runPromise(
      first.append([{ type: 'todo-added', payload: { todoId: 'todo-1' } }]),
    )
    first.close()
    const partial = '{"version":2,"committedAt":"2026-'
    appendFileSync(path, partial)

    const reopened = createJsonlEventLog({ path })
    expect(reopened.discardedTrailingBytes).toBe(partial.length)
    expect(await Effect.runPromise(reopened.currentVersion)).toBe(1)
    await Effect.runPromise(
      reopened.append([{ type: 'todo-added', payload: { todoId: 'todo-2' } }]),
    )
    reopened.close()

    const lines = readFileSync(path, 'utf8').split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[2]).toBe('')
    const again = createJsonlEventLog({ path })
    expect(again.discardedTrailingBytes).toBe(0)
    expect(await Effect.runPromise(again.currentVersion)).toBe(2)
    again.close()
  })

  it('fails to open when a complete line is malformed', () => {
    const path = temporaryLogPath()
    createJsonlEventLog({ path }).close()
    appendFileSync(path, '{"version":5,"events":[]}\n')
    expect(() => createJsonlEventLog({ path })).toThrow(/malformed/)
  })

  it('enforces expected versions and returns the first commit for a reused key', async () => {
    const eventLog = createJsonlEventLog({ path: temporaryLogPath() })
    const append = () =>
      Effect.runPromise(
        eventLog.append([{ type: 'counter-incremented', payload: {} }], {
          expectedVersion: 0,
        }),
      )
    const results = await Promise.allSettled([append(), append()])
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1,
    )
    expect(results.find(({ status }) => status === 'rejected')).toMatchObject({
      reason: expect.objectContaining({
        _tag: 'EventLogFailure',
        cause: expect.any(SpecterVersionConflictError),
      }),
    })

    const first = await Effect.runPromise(
      eventLog.append([{ type: 'todo-added', payload: {} }], {
        idempotencyKey: 'request-1',
        fingerprint: 'fingerprint-one',
      }),
    )
    const changed = await Effect.runPromise(
      eventLog.append([{ type: 'todo-changed', payload: {} }], {
        idempotencyKey: 'request-1',
        fingerprint: 'fingerprint-two',
      }),
    )
    expect(changed).toEqual({ ...first, duplicate: true })
    expect(changed.fingerprint).toBe('fingerprint-one')
    expect(await Effect.runPromise(eventLog.currentVersion)).toBe(first.version)
    eventLog.close()
  })

  it('rejects payloads that JSON cannot represent', async () => {
    const eventLog = createJsonlEventLog({ path: temporaryLogPath() })
    const result = await Effect.runPromise(
      Effect.result(
        eventLog.append([{ type: 'callback-registered', payload: () => 1 }]),
      ),
    )
    expect(result._tag).toBe('Failure')
    expect(await Effect.runPromise(eventLog.currentVersion)).toBe(0)
    eventLog.close()
  })

  it('closes idempotently and releases the lock', async () => {
    const path = temporaryLogPath()
    const eventLog = createJsonlEventLog({ path })
    expect(existsSync(`${path}.lock`)).toBe(true)
    eventLog.close()
    eventLog.close()
    expect(existsSync(`${path}.lock`)).toBe(false)
    const result = await Effect.runPromise(
      Effect.result(eventLog.append([{ type: 'todo-added', payload: {} }])),
    )
    expect(result._tag).toBe('Failure')
    createJsonlEventLog({ path }).close()
  })

  it('rejects a second open of the same file', () => {
    const path = temporaryLogPath()
    const eventLog = createJsonlEventLog({ path })
    expect(() => createJsonlEventLog({ path })).toThrow(/already open/)
    eventLog.close()
    createJsonlEventLog({ path }).close()
  })

  it('reports a stale lock file without taking it over', async () => {
    const path = temporaryLogPath()
    const first = createJsonlEventLog({ path })
    await Effect.runPromise(first.append([{ type: 'todo-added', payload: {} }]))
    first.close()
    const before = readFileSync(path)
    writeFileSync(`${path}.lock`, '999999\n')
    expect(() => createJsonlEventLog({ path })).toThrow(`${path}.lock`)
    expect(readFileSync(path)).toEqual(before)
    expect(readFileSync(`${path}.lock`, 'utf8')).toBe('999999\n')
  })

  it.each([
    ['a JSON document', '{"name":"not a log","items":[1,2]}'],
    ['a text file', 'hello\nworld'],
    [
      'a malformed line before a torn tail',
      '{"version":1}\n{"version":2,"comm',
    ],
  ])('leaves %s byte-identical when the open fails', (_name, content) => {
    const path = temporaryLogPath()
    createJsonlEventLog({ path }).close()
    writeFileSync(path, content)
    expect(() => createJsonlEventLog({ path })).toThrow()
    expect(readFileSync(path, 'utf8')).toBe(content)
    expect(existsSync(`${path}.lock`)).toBe(false)
  })

  it('keeps a complete last commit whose newline was lost', async () => {
    const path = temporaryLogPath()
    const first = createJsonlEventLog({ path })
    for (const todoId of ['todo-1', 'todo-2']) {
      await Effect.runPromise(
        first.append([{ type: 'todo-added', payload: { todoId } }]),
      )
    }
    first.close()
    writeFileSync(path, readFileSync(path, 'utf8').replace(/\n$/, ''))

    const reopened = createJsonlEventLog({ path })
    expect(reopened.discardedTrailingBytes).toBe(0)
    expect(await Effect.runPromise(reopened.currentVersion)).toBe(2)
    await Effect.runPromise(
      reopened.append([{ type: 'todo-added', payload: { todoId: 'todo-3' } }]),
    )
    reopened.close()
    const again = createJsonlEventLog({ path })
    expect(
      (await Effect.runPromise(again.query(0, ['todo-added']))).map(
        (event) => event.order,
      ),
    ).toEqual([1, 2, 3])
    again.close()
  })

  it('matches no Events for a NaN cursor', async () => {
    const eventLog = createJsonlEventLog({ path: temporaryLogPath() })
    await Effect.runPromise(
      eventLog.append([{ type: 'todo-added', payload: {} }]),
    )
    expect(
      await Effect.runPromise(eventLog.query(Number.NaN, ['todo-added'])),
    ).toEqual([])
    expect(
      await Effect.runPromise(eventLog.query(0.5, ['todo-added'])),
    ).toHaveLength(1)
    eventLog.close()
  })
})
