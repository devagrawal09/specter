import { randomUUID } from 'node:crypto'

import type {
  ReactionOutboxAttemptContext,
  ReactionOutboxStore,
  ReactionOutboxTransitionListener,
} from './types'
import { ReactionOutboxLeaseLostError } from './errors'

const errorSummary = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause)

export type ReactionOutboxFailure = {
  readonly jobId: string
  readonly attemptId: string
  readonly cause: unknown
}

export class ReactionOutboxDrainFailure extends AggregateError {
  readonly failures: readonly ReactionOutboxFailure[]

  constructor(failures: readonly ReactionOutboxFailure[]) {
    super(
      failures.map((failure) => failure.cause),
      `${failures.length} Reaction outbox job${failures.length === 1 ? '' : 's'} moved to dead-letter`,
    )
    this.name = 'ReactionOutboxDrainFailure'
    this.failures = failures
  }
}

export type EnqueueReactionOptions = {
  readonly jobId?: string
  readonly idempotencyKey?: string
  readonly availableAt?: Date
}

export type ReactionOutboxWorkerOptions<TPayload> = {
  readonly store: ReactionOutboxStore<TPayload>
  readonly handle: (
    payload: TPayload,
    context: ReactionOutboxAttemptContext,
  ) => Promise<void>
  readonly maxAttempts?: number
  readonly backoffMs?: (attemptNumber: number) => number
  readonly leaseMs?: number
  readonly now?: () => Date
  readonly sleep?: (milliseconds: number) => Promise<void>
  readonly signal?: AbortSignal
  readonly idFactory?: () => string
  readonly onTransition?: ReactionOutboxTransitionListener<TPayload>
}

export type ReactionOutboxWorker<TPayload> = {
  enqueue(
    payload: TPayload,
    options?: EnqueueReactionOptions,
  ): Promise<{ readonly jobId: string; readonly created: boolean }>
  drain(): Promise<void>
  retryDeadLetter(jobId: string, availableAt?: Date): Promise<void>
}

export type ReactionOutboxServiceOptions = {
  readonly signal?: AbortSignal
  readonly pollIntervalMs?: number
  readonly sleep?: (milliseconds: number) => Promise<void>
  readonly onError?: (cause: unknown) => Promise<void> | void
}

const defaultSleep = (milliseconds: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const timeout = setTimeout(finish, milliseconds)
    signal?.addEventListener('abort', finish, { once: true })

    function finish() {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
  })

export function createReactionOutboxWorker<TPayload>(
  options: ReactionOutboxWorkerOptions<TPayload>,
): ReactionOutboxWorker<TPayload> {
  const maxAttempts = options.maxAttempts ?? 5
  const leaseMs = options.leaseMs ?? 5 * 60 * 1_000
  const backoffMs =
    options.backoffMs ?? ((attemptNumber) => 1_000 * 2 ** (attemptNumber - 1))
  const now = options.now ?? (() => new Date())
  const sleep =
    options.sleep ??
    ((milliseconds: number) => defaultSleep(milliseconds, options.signal))
  const idFactory = options.idFactory ?? randomUUID
  const onTransition = options.onTransition ?? (() => {})
  let activeDrain: Promise<void> | undefined
  let drainRequested = false

  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error('maxAttempts must be a positive integer')
  }
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
    throw new Error('leaseMs must be positive')
  }

  async function notify(
    transition: Parameters<ReactionOutboxTransitionListener<TPayload>>[0],
  ) {
    try {
      await onTransition(transition)
    } catch {
      // Operational reporting must never change durable delivery semantics.
    }
  }

  async function enqueue(
    payload: TPayload,
    enqueueOptions: EnqueueReactionOptions = {},
  ) {
    const requestedAt = now()
    const id = enqueueOptions.jobId ?? idFactory()
    const result = await options.store.enqueue({
      id,
      idempotencyKey: enqueueOptions.idempotencyKey ?? id,
      payload,
      requestedAt,
      availableAt: enqueueOptions.availableAt ?? requestedAt,
    })
    await notify({ type: 'enqueued', ...result })
    return { jobId: result.job.id, created: result.created }
  }

  async function runDrain() {
    const failures: ReactionOutboxFailure[] = []

    for (;;) {
      if (options.signal?.aborted) break
      const claimTime = now()
      await options.store.requeueExpired(claimTime)
      const claim = await options.store.claimNext(
        claimTime,
        new Date(claimTime.getTime() + leaseMs),
      )

      if (!claim) {
        const nextWorkAt = await options.store.nextWorkAt()
        if (!nextWorkAt) break
        const delay = Math.max(0, nextWorkAt.getTime() - now().getTime())
        if (delay > 0) await sleep(delay)
        if (options.signal?.aborted) break
        continue
      }

      await notify({ type: 'attempt-started', claim })
      const context: ReactionOutboxAttemptContext = {
        jobId: claim.id,
        idempotencyKey: claim.idempotencyKey,
        requestedAt: claim.requestedAt,
        attemptId: claim.activeAttemptId,
        attemptNumber: claim.attemptCount,
      }

      try {
        await options.handle(claim.payload, context)
        const completedAt = now()
        await options.store.complete(
          claim.id,
          claim.activeAttemptId,
          completedAt,
        )
        await notify({
          type: 'attempt-completed',
          claim,
          completedAt,
        })
      } catch (cause) {
        if (cause instanceof ReactionOutboxLeaseLostError) continue
        const error = errorSummary(cause)
        if (claim.attemptCount >= maxAttempts) {
          const failedAt = now()
          try {
            await options.store.deadLetter(
              claim.id,
              claim.activeAttemptId,
              failedAt,
              error,
            )
          } catch (deadLetterCause) {
            if (deadLetterCause instanceof ReactionOutboxLeaseLostError) {
              continue
            }
            throw deadLetterCause
          }
          await notify({
            type: 'dead-lettered',
            claim,
            failedAt,
            error,
          })
          failures.push({
            jobId: claim.id,
            attemptId: claim.activeAttemptId,
            cause,
          })
          continue
        }

        const delay = backoffMs(claim.attemptCount)
        if (!Number.isFinite(delay) || delay < 0) {
          throw new Error('Reaction outbox backoff must be non-negative')
        }
        const availableAt = new Date(now().getTime() + delay)
        try {
          await options.store.reschedule(
            claim.id,
            claim.activeAttemptId,
            availableAt,
            error,
          )
        } catch (rescheduleCause) {
          if (rescheduleCause instanceof ReactionOutboxLeaseLostError) continue
          throw rescheduleCause
        }
        await notify({
          type: 'attempt-retrying',
          claim,
          availableAt,
          error,
        })
      }
    }

    if (failures.length) throw new ReactionOutboxDrainFailure(failures)
  }

  return {
    enqueue,
    drain() {
      drainRequested = true
      if (!activeDrain) {
        activeDrain = (async () => {
          const failures: ReactionOutboxFailure[] = []
          do {
            drainRequested = false
            try {
              await runDrain()
            } catch (cause) {
              if (cause instanceof ReactionOutboxDrainFailure) {
                failures.push(...cause.failures)
              } else {
                throw cause
              }
            }
          } while (drainRequested)

          if (failures.length) throw new ReactionOutboxDrainFailure(failures)
        })().finally(() => {
          activeDrain = undefined
        })
      }
      return activeDrain
    },
    async retryDeadLetter(jobId, availableAt = now()) {
      await options.store.retryDeadLetter(jobId, availableAt)
      await notify({ type: 'dead-letter-retried', jobId, availableAt })
    },
  }
}

/** Runs drain passes until aborted, polling for effects enqueued by other processes. */
export async function runReactionOutboxWorker<TPayload>(
  worker: ReactionOutboxWorker<TPayload>,
  options: ReactionOutboxServiceOptions = {},
) {
  const pollIntervalMs = options.pollIntervalMs ?? 1_000
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new Error('pollIntervalMs must be positive')
  }
  const sleep =
    options.sleep ??
    ((milliseconds: number) => defaultSleep(milliseconds, options.signal))

  while (!options.signal?.aborted) {
    try {
      await worker.drain()
    } catch (cause) {
      if (!options.onError) throw cause
      await options.onError(cause)
    }
    if (options.signal?.aborted) break
    await sleep(pollIntervalMs)
  }
}
