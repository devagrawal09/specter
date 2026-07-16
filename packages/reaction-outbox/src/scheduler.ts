import type { ReactionScheduler } from '@specter-ts/core'

import type {
  ReactionOutboxStore,
  ReactionOutboxTransitionListener,
} from './types'
import { createReactionOutboxWorker } from './worker'

export type DurableReactionSchedulerOptions = {
  readonly maxAttempts?: number
  readonly backoffMs?: (attemptNumber: number) => number
  readonly leaseMs?: number
  readonly now?: () => Date
  readonly sleep?: (milliseconds: number) => Promise<void>
  readonly signal?: AbortSignal
  readonly idFactory?: () => string
  readonly onTransition?: ReactionOutboxTransitionListener<ReactionPass>
  readonly onBackgroundError?: (cause: unknown) => void
}

export type ReactionPass = {
  readonly kind: 'reaction-pass'
}

export function createDurableReactionScheduler(
  store: ReactionOutboxStore<ReactionPass>,
  options: DurableReactionSchedulerOptions = {},
): ReactionScheduler {
  return (run) => {
    const worker = createReactionOutboxWorker({
      ...options,
      store,
      handle: async (_payload, context) => {
        await run({
          deliveryId: context.jobId,
          scheduledAt: context.requestedAt.toISOString(),
          attemptId: context.attemptId,
          attemptNumber: context.attemptNumber,
        })
      },
    })

    void worker.drain().catch((cause) => {
      options.onBackgroundError?.(cause)
    })

    return () => {
      const completion = worker
        .enqueue({ kind: 'reaction-pass' })
        .then(() => worker.drain())
      return () => completion
    }
  }
}
