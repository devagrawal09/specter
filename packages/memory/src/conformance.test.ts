import { ReactionScheduler } from '@specter-ts/core'
import {
  reactionSchedulerConformance,
  testEventLogService,
  testSliceStoreService,
} from '@specter-ts/core/testing'
import { Effect } from 'effect'
import { it } from 'vitest'

import { createMemoryEventLog } from './event-log'
import { createImmediateReactionSchedulerLayer } from './reaction-scheduler'
import { createMemorySliceStoreService } from './slice-store'

testEventLogService('memory', createMemoryEventLog)

testSliceStoreService('memory', {
  createService: () => createMemorySliceStoreService(() => ({ value: 0 })),
  write: async (state, value: number) => {
    state.value = value
  },
  read: async (state) => state.value,
  value: 42,
})

it('memory scheduler conforms', async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.provide(
        Effect.flatMap(ReactionScheduler, (service) =>
          reactionSchedulerConformance(Effect.succeed(service)),
        ),
        createImmediateReactionSchedulerLayer({ now: () => new Date(0) }),
      ),
    ),
  )
})
