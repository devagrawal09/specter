import { SpecterVersionConflictError } from '@specter-ts/core'
import { testEventLogService } from '@specter-ts/core/testing'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { createMemoryEventLog } from './event-log'

testEventLogService('memory', () => createMemoryEventLog())

describe('memory Event Log', () => {
  it('assigns deterministic metadata and returns ordered queries', async () => {
    const eventLog = createMemoryEventLog()
    const commit = await Effect.runPromise(
      eventLog.append([
        { type: 'todo-added', payload: { todoId: 'todo-1' } },
        { type: 'todo-added', payload: { todoId: 'todo-2' } },
      ]),
    )
    expect(commit.events.map(({ order }) => order)).toEqual([1, 2])
    expect(await Effect.runPromise(eventLog.query(1, ['todo-added']))).toEqual([
      commit.events[1],
    ])
  })

  it('does not impose JSON serialization on in-process payloads', async () => {
    const eventLog = createMemoryEventLog()
    const callback = () => 'local-only'
    await Effect.runPromise(
      eventLog.append([{ type: 'callback-registered', payload: callback }]),
    )
    const queried = await Effect.runPromise(
      eventLog.query(0, ['callback-registered']),
    )
    expect(queried[0]?.payload).toBe(callback)
  })

  it('atomically enforces expected versions', async () => {
    const eventLog = createMemoryEventLog()
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
    const rejected = results.find(({ status }) => status === 'rejected')
    expect(rejected).toMatchObject({
      reason: expect.objectContaining({
        _tag: 'EventLogFailure',
        cause: expect.any(SpecterVersionConflictError),
      }),
    })
  })

  it('returns the first commit for a reused key regardless of fingerprint', async () => {
    const eventLog = createMemoryEventLog()
    const first = await Effect.runPromise(
      eventLog.append([{ type: 'todo-added', payload: { todoId: 'todo-1' } }], {
        idempotencyKey: 'request-1',
        fingerprint: 'fingerprint-one',
      }),
    )
    const duplicate = await Effect.runPromise(
      eventLog.append([{ type: 'ignored', payload: {} }], {
        idempotencyKey: 'request-1',
        fingerprint: 'fingerprint-one',
      }),
    )
    expect(duplicate).toEqual({ ...first, duplicate: true })
    const changed = await Effect.runPromise(
      eventLog.append([{ type: 'ignored', payload: {} }], {
        idempotencyKey: 'request-1',
        fingerprint: 'fingerprint-two',
      }),
    )
    expect(changed).toEqual({ ...first, duplicate: true })
    expect(changed.fingerprint).toBe('fingerprint-one')
    expect(eventLog.inspect()).toHaveLength(1)
  })
})
