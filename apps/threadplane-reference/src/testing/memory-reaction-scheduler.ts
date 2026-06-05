import type { ReactionScheduler } from '@specter-ts/core'

export const memoryReactionScheduler = createMemoryReactionScheduler()

function createMemoryReactionScheduler(): ReactionScheduler {
  return {
    bind: (run) => {
      let runRequested = false
      let activeRun: Promise<void> | undefined
      let waiters: {
        resolve: () => void
        reject: (cause: unknown) => void
      }[] = []

      function resolveWaiters() {
        const settledWaiters = waiters
        waiters = []

        for (const waiter of settledWaiters) waiter.resolve()
      }

      function rejectWaiters(cause: unknown) {
        const settledWaiters = waiters
        waiters = []

        for (const waiter of settledWaiters) waiter.reject(cause)
      }

      async function drain() {
        try {
          do {
            runRequested = false
            await run()
          } while (runRequested)

          resolveWaiters()
        } catch (cause) {
          runRequested = false
          rejectWaiters(cause)
        } finally {
          activeRun = undefined
        }
      }

      return {
        request: () => {
          runRequested = true

          if (!activeRun) activeRun = drain()
        },
        waitForIdle: () => {
          if (!activeRun && !runRequested) return Promise.resolve()

          return new Promise<void>((resolve, reject) => {
            waiters.push({ resolve, reject })
          })
        },
      }
    },
  }
}
