import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { createImmediateReactionSchedulerService } from './reaction-scheduler'

describe('immediate Reaction scheduler', () => {
  it('does not retain a failed execution and retries on the next run', async () => {
    const scheduler = createImmediateReactionSchedulerService({
      now: () => new Date(0),
    })
    let executions = 0
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const bound = yield* scheduler.bind({
            execute: () =>
              Effect.gen(function* () {
                executions += 1
                if (executions === 1) return yield* Effect.fail('transient')
              }),
          })
          const first = yield* bound.schedule(1)
          yield* Effect.result(first)
          const second = yield* bound.schedule(1)
          yield* second
        }),
      ),
    )

    expect(executions).toBe(2)
  })
})
