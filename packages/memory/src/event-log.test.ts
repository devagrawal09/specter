import {
  SpecterIdempotencyConflictError,
  SpecterVersionConflictError,
} from '@specter-ts/core'
import { describe, expect, it } from 'vitest'

import { createMemoryEventLog } from './event-log'

describe('memory Event Log', () => {
  it('assigns deterministic metadata and returns strictly ordered queries', async () => {
    const eventLog = createMemoryEventLog()
    const commit = await eventLog.append([
      { type: 'todo-added', payload: { todoId: 'todo-1' } },
      { type: 'todo-added', payload: { todoId: 'todo-2' } },
    ])

    expect(commit).toEqual({
      events: [
        {
          id: 'event-1',
          order: 1,
          recordedAt: new Date(0).toISOString(),
          type: 'todo-added',
          payload: { todoId: 'todo-1' },
        },
        {
          id: 'event-2',
          order: 2,
          recordedAt: new Date(1).toISOString(),
          type: 'todo-added',
          payload: { todoId: 'todo-2' },
        },
      ],
      version: 2,
      idempotencyKey: undefined,
      fingerprint: undefined,
      duplicate: false,
    })
    expect(await eventLog.query(1, ['todo-added'])).toEqual([commit.events[1]])
  })

  it('rolls back failed transactions', async () => {
    const eventLog = createMemoryEventLog()

    await expect(
      eventLog.transaction(async (transaction) => {
        await transaction.append([{ type: 'one', payload: {} }])
        throw new Error('decision failed')
      }),
    ).rejects.toThrow('decision failed')

    expect(await eventLog.currentVersion()).toBe(0)
    expect(eventLog.inspect()).toEqual([])
  })

  it('does not impose JSON serialization on in-process Event payloads', async () => {
    const eventLog = createMemoryEventLog()
    const callback = () => 'local-only'

    await eventLog.append([{ type: 'callback-registered', payload: callback }])

    expect((await eventLog.query(0, ['callback-registered']))[0]?.payload).toBe(
      callback,
    )
  })

  it('serializes concurrent commands and atomically enforces expected versions', async () => {
    const eventLog = createMemoryEventLog()
    const appendAtVersionZero = () =>
      eventLog.transaction((transaction) =>
        transaction.append([{ type: 'counter-incremented', payload: {} }], {
          expectedVersion: 0,
        }),
      )

    const results = await Promise.allSettled([
      appendAtVersionZero(),
      appendAtVersionZero(),
    ])

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1)
    const rejected = results.find((result) => result.status === 'rejected')
    expect(rejected).toMatchObject({
      reason: expect.any(SpecterVersionConflictError),
    })
    expect(await eventLog.currentVersion()).toBe(1)
  })

  it('returns the durable commit for a duplicate key and rejects a changed fingerprint', async () => {
    const eventLog = createMemoryEventLog()
    const first = await eventLog.append(
      [{ type: 'todo-added', payload: { todoId: 'todo-1' } }],
      {
        idempotencyKey: 'request-1',
        fingerprint: 'fingerprint-one',
      },
    )
    const duplicate = await eventLog.append(
      [{ type: 'this-draft-is-not-used', payload: {} }],
      {
        idempotencyKey: 'request-1',
        fingerprint: 'fingerprint-one',
      },
    )

    expect(first.duplicate).toBe(false)
    expect(duplicate).toEqual({ ...first, duplicate: true })
    expect(eventLog.inspect()).toHaveLength(1)
    await expect(
      eventLog.append([{ type: 'todo-added', payload: { todoId: 'todo-2' } }], {
        idempotencyKey: 'request-1',
        fingerprint: 'fingerprint-two',
      }),
    ).rejects.toBeInstanceOf(SpecterIdempotencyConflictError)
  })
})
