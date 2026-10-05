import { randomUUID } from 'node:crypto'
import { Effect } from 'effect'

import type {
  ReactionOutboxAttemptContext,
  ReactionOutboxClaim,
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
  readonly requestedAt?: Date
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
  /**
   * How often a running attempt renews its lease when the Store implements
   * `renewLease`. Must be shorter than `leaseMs`; defaults to a third of it.
   */
  readonly heartbeatMs?: number
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
  /**
   * Resolves after `milliseconds`, when either lifecycle signal aborts, or as
   * soon as this worker's Store reports new work in this process. A wake-up
   * that arrives while no wait is in progress ends the next wait at once.
   */
  waitForWork(
    milliseconds: number,
    options?: ReactionOutboxWaitOptions,
  ): Promise<void>
}

export type ReactionOutboxWaitOptions = {
  /** Replaces the timer; a wake-up or abort still ends the wait early. */
  readonly sleep?: (milliseconds: number) => Promise<void>
  readonly signal?: AbortSignal
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
  const heartbeatMs = options.heartbeatMs ?? leaseMs / 3
  const idFactory = options.idFactory ?? randomUUID
  const onTransition = options.onTransition ?? (() => {})
  let activeDrain: Promise<void> | undefined
  let drainRequested = false
  /** Interrupts for waits in progress. */
  const wakers = new Set<() => void>()
  /** A wake-up arrived while no wait was in progress. */
  let wakePending = false

  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error('maxAttempts must be a positive integer')
  }
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
    throw new Error('leaseMs must be positive')
  }
  if (
    !Number.isFinite(heartbeatMs) ||
    heartbeatMs <= 0 ||
    heartbeatMs >= leaseMs
  ) {
    throw new Error('heartbeatMs must be positive and shorter than leaseMs')
  }
  if (options.store.subscribe && !options.signal?.aborted) {
    const unsubscribe = options.store.subscribe(wake)
    options.signal?.addEventListener('abort', unsubscribe, { once: true })
  }

  function wake() {
    if (wakers.size === 0) {
      wakePending = true
      return
    }
    for (const interrupt of [...wakers]) interrupt()
  }

  function waitForWork(
    milliseconds: number,
    waitOptions: ReactionOutboxWaitOptions = {},
  ): Promise<void> {
    const signals = [options.signal, waitOptions.signal].filter(
      (signal) => signal !== undefined,
    )
    if (signals.some((signal) => signal.aborted)) return Promise.resolve()
    if (wakePending) {
      wakePending = false
      return Promise.resolve()
    }
    const controller = new AbortController()
    const interrupt = () => controller.abort()
    for (const signal of signals) {
      signal.addEventListener('abort', interrupt, { once: true })
    }
    wakers.add(interrupt)
    const slept = waitOptions.sleep
      ? Promise.race([
          waitOptions.sleep(milliseconds),
          new Promise<void>((resolve) => {
            controller.signal.addEventListener('abort', () => resolve(), {
              once: true,
            })
          }),
        ])
      : defaultSleep(milliseconds, controller.signal)
    return slept.finally(() => {
      wakers.delete(interrupt)
      for (const signal of signals) {
        signal.removeEventListener('abort', interrupt)
      }
    })
  }

  /** Runs the handler while renewing the attempt lease, if the Store can. */
  async function handleWithHeartbeat(
    claim: ReactionOutboxClaim<TPayload>,
    context: ReactionOutboxAttemptContext,
  ) {
    const { store } = options
    if (!store.renewLease) {
      await options.handle(claim.payload, context)
      return
    }
    let renewal: Promise<void> | undefined
    const timer = setInterval(() => {
      if (renewal) return
      const renew = store.renewLease?.(
        claim.id,
        claim.activeAttemptId,
        new Date(now().getTime() + leaseMs),
      )
      if (!renew) return
      renewal = Effect.runPromise(renew)
        .then(
          () => {},
          (cause) => {
            // A lost attempt stops renewing; completion then reports the
            // loss. Other failures retry on the next beat.
            if (cause instanceof ReactionOutboxLeaseLostError) {
              clearInterval(timer)
            }
          },
        )
        .finally(() => {
          renewal = undefined
        })
    }, heartbeatMs)
    try {
      await options.handle(claim.payload, context)
    } finally {
      clearInterval(timer)
      await renewal
    }
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
    const requestedAt = enqueueOptions.requestedAt ?? now()
    const id = enqueueOptions.jobId ?? idFactory()
    const result = await Effect.runPromise(
      options.store.enqueue({
        id,
        idempotencyKey: enqueueOptions.idempotencyKey ?? id,
        payload,
        requestedAt,
        availableAt: enqueueOptions.availableAt ?? requestedAt,
      }),
    )
    await notify({ type: 'enqueued', ...result })
    if (result.created) wake()
    return { jobId: result.job.id, created: result.created }
  }

  async function runDrain() {
    const failures: ReactionOutboxFailure[] = []

    for (;;) {
      if (options.signal?.aborted) break
      const claimTime = now()
      await Effect.runPromise(options.store.requeueExpired(claimTime))
      const claim = await Effect.runPromise(
        options.store.claimNext(
          claimTime,
          new Date(claimTime.getTime() + leaseMs),
        ),
      )

      if (!claim) {
        const nextWorkAt = await Effect.runPromise(options.store.nextWorkAt())
        if (!nextWorkAt) break
        const delay = Math.max(0, nextWorkAt.getTime() - now().getTime())
        if (delay > 0) await waitForWork(delay, { sleep: options.sleep })
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
        await handleWithHeartbeat(claim, context)
        const completedAt = now()
        await Effect.runPromise(
          options.store.complete(claim.id, claim.activeAttemptId, completedAt),
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
            await Effect.runPromise(
              options.store.deadLetter(
                claim.id,
                claim.activeAttemptId,
                failedAt,
                error,
              ),
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
          await Effect.runPromise(
            options.store.reschedule(
              claim.id,
              claim.activeAttemptId,
              availableAt,
              error,
            ),
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
      await Effect.runPromise(options.store.retryDeadLetter(jobId, availableAt))
      await notify({ type: 'dead-letter-retried', jobId, availableAt })
      wake()
    },
    waitForWork,
  }
}

/**
 * Runs drain passes until aborted. Between passes it waits `pollIntervalMs`
 * for work enqueued by other processes, or less when the Store reports new
 * work in this process.
 */
export async function runReactionOutboxWorker<TPayload>(
  worker: ReactionOutboxWorker<TPayload>,
  options: ReactionOutboxServiceOptions = {},
) {
  const pollIntervalMs = options.pollIntervalMs ?? 1_000
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new Error('pollIntervalMs must be positive')
  }
  while (!options.signal?.aborted) {
    try {
      await worker.drain()
    } catch (cause) {
      if (!options.onError) throw cause
      await options.onError(cause)
    }
    if (options.signal?.aborted) break
    await worker.waitForWork(pollIntervalMs, {
      sleep: options.sleep,
      signal: options.signal,
    })
  }
}
