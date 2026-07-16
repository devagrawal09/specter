import type {
  ReactionDeliveryContext,
  ReactionScheduler,
} from '@specter-ts/core'

export type ImmediateReactionSchedulerOptions = {
  readonly deliveryId?: (sequence: number) => string
  readonly now?: () => Date
}

export function createImmediateReactionScheduler(
  options: ImmediateReactionSchedulerOptions = {},
): ReactionScheduler {
  const deliveryId =
    options.deliveryId ?? ((sequence) => `memory-reaction-pass-${sequence}`)
  const now = options.now ?? (() => new Date())

  return (run) => {
    const requestedRuns: ReactionDeliveryContext[] = []
    let activeRun: Promise<void> | undefined
    let sequence = 0

    async function drain() {
      while (requestedRuns.length > 0) {
        const context = requestedRuns.shift()
        if (context) await run(context)
      }
    }

    return () => {
      sequence += 1
      const id = deliveryId(sequence)
      requestedRuns.push({
        deliveryId: id,
        scheduledAt: now().toISOString(),
        attemptId: `${id}:attempt:1`,
        attemptNumber: 1,
      })
      if (!activeRun) {
        activeRun = drain()
          .catch((cause) => {
            requestedRuns.length = 0
            throw cause
          })
          .finally(() => {
            activeRun = undefined
          })
      }
      const completion = activeRun
      return () => completion
    }
  }
}

export const immediateReactionScheduler = createImmediateReactionScheduler()
