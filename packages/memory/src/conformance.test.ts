import { EventLogFailure, type EventLogService } from '@specter-ts/core'
import {
  AdapterConformanceFailure,
  eventLogConformance,
  testEventLogService,
  testSliceStoreService,
} from '@specter-ts/core/testing'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { createMemoryEventLog } from './event-log'
import { createMemorySliceStoreService } from './slice-store'

testEventLogService('memory', createMemoryEventLog)

// An Event Log without the capabilities refuses what it does not support.
testEventLogService('memory without scoped appends or keyed reads', () => {
  const eventLog = createMemoryEventLog()
  return {
    ...eventLog,
    capabilities: { scopedAppend: false, keyedRead: false },
    append: (drafts, options) =>
      options?.expectedUnchanged
        ? Effect.fail(new EventLogFailure('append', new Error('Unsupported.')))
        : eventLog.append(drafts, options),
    readKey: () =>
      Effect.fail(new EventLogFailure('readKey', new Error('Unsupported.'))),
  } satisfies EventLogService
})

describe('memory Event Log conformance of capabilities', () => {
  const invariantOf = (eventLog: EventLogService) =>
    Effect.runPromise(
      Effect.flip(eventLogConformance(Effect.succeed(eventLog))),
    ).then((failure) =>
      failure instanceof AdapterConformanceFailure
        ? failure.invariant
        : failure,
    )

  it('fails an Event Log that declares scoped appends but ignores them', async () => {
    const eventLog = createMemoryEventLog()
    await expect(
      invariantOf({
        ...eventLog,
        append: (drafts, options) =>
          eventLog.append(drafts, { ...options, expectedUnchanged: undefined }),
      }),
    ).resolves.toBe('a scoped append is stale for a later Event of its types')
  })

  it('fails an Event Log that declares no scoped appends but appends without the check', async () => {
    const eventLog = createMemoryEventLog()
    await expect(
      invariantOf({
        ...eventLog,
        capabilities: { scopedAppend: false, keyedRead: true },
        append: (drafts, options) =>
          eventLog.append(drafts, { ...options, expectedUnchanged: undefined }),
      }),
    ).resolves.toBe(
      'an Event Log without scopedAppend refuses expectedUnchanged',
    )
  })
})

testSliceStoreService('memory', {
  createService: () => createMemorySliceStoreService(() => ({ value: 0 })),
  write: async (state, value: number) => {
    state.value = value
  },
  read: async (state) => state.value,
  value: 42,
})
