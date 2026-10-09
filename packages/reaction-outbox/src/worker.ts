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
  readonly concurrencyKey?: string
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
  /**
   * How many attempts run at once (default 1). Above 1 the Store must honor
   * concurrency keys: jobs with the same key still run one at a time, in
   * order.
   */
  readonly concurrency?: number
  readonly backoffMs?: (attemptNumber: number) => number
  readonly leaseMs?: number
  /**
   * How often a running attempt renews its lease when the Store implements
   * `renewLease`. Must be shorter than `leaseMs` and at most 2,147,483,647
   * (the largest timer delay); defaults to a third of `leaseMs`, capped there.
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
   * Waits share one wake-up: a caller waiting here alongside `drain` can take
   * a wake-up meant for it, which then finds the work on its next poll or
   * backoff wait.
   */
  waitForWork(
    milliseconds: number,
    options?: ReactionOutboxWaitOptions,
  ): Promise<void>
  /**
   * Stops the worker like aborting its `signal`: unsubscribes from the Store,
   * ends waits, and lets a running drain finish its current attempt and stop.
   * A worker without a `signal` stays subscribed to its Store until closed.
   */
  close(): void
  /** Aborted once the worker is closed or its `signal` aborts. */
  readonly signal: AbortSignal
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

/** Node clamps larger timer delays to 1 ms. */
const maxTimerMs = 2_147_483_647

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
  const heartbeatMs = options.heartbeatMs ?? Math.min(leaseMs / 3, maxTimerMs)
  const idFactory = options.idFactory ?? randomUUID
  const onTransition = options.onTransition ?? (() => {})
  const concurrency = options.concurrency ?? 1
  let activeDrain: Promise<void> | undefined
  let drainRequested = false
  /** Interrupts for waits in progress. */
  const wakers = new Set<() => void>()
  /** A wake-up arrived while no wait was in progress. */
  let wakePending = false
  /** Aborted by `close()` or by `options.signal`. */
  const lifecycle = new AbortController()
  const signal = lifecycle.signal

  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error('maxAttempts must be a positive integer')
  }
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('concurrency must be a positive integer')
  }
  if (concurrency > 1 && !options.store.concurrencyKeys) {
    throw new Error(
      'concurrency above 1 needs a Store that honors concurrency keys',
    )
  }
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
    throw new Error('leaseMs must be positive')
  }
  if (
    !Number.isFinite(heartbeatMs) ||
    heartbeatMs <= 0 ||
    heartbeatMs >= leaseMs ||
    heartbeatMs > maxTimerMs
  ) {
    throw new Error(
      `heartbeatMs must be positive, shorter than leaseMs, and at most ${maxTimerMs}`,
    )
  }
  if (options.signal?.aborted) lifecycle.abort()
  else {
    options.signal?.addEventListener('abort', () => lifecycle.abort(), {
      once: true,
    })
  }
  if (options.store.subscribe && !signal.aborted) {
    const unsubscribe = options.store.subscribe(wake)
    signal.addEventListener('abort', unsubscribe, { once: true })
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
    const signals = [signal, waitOptions.signal].filter(
      (candidate) => candidate !== undefined,
    )
    if (signals.some((candidate) => candidate.aborted)) {
      return Promise.resolve()
    }
    if (wakePending) {
      wakePending = false
      return Promise.resolve()
    }
    const controller = new AbortController()
    const interrupt = () => controller.abort()
    for (const candidate of signals) {
      candidate.addEventListener('abort', interrupt, { once: true })
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
      for (const candidate of signals) {
        candidate.removeEventListener('abort', interrupt)
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
          async (cause) => {
            // A lost attempt stops renewing; completion then reports the
            // loss. Other failures retry on the next beat.
            const leaseLost = cause instanceof ReactionOutboxLeaseLostError
            if (leaseLost) clearInterval(timer)
            await notify({
              type: 'lease-renewal-failed',
              claim,
              leaseLost,
              error: errorSummary(cause),
            })
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
        ...(enqueueOptions.concurrencyKey === undefined
          ? {}
          : { concurrencyKey: enqueueOptions.concurrencyKey }),
        payload,
        requestedAt,
        availableAt: enqueueOptions.availableAt ?? requestedAt,
      }),
    )
    await notify({ type: 'enqueued', ...result })
    if (result.created) wake()
    return { jobId: result.job.id, created: result.created }
  }

  /** Runs one claimed attempt to its recorded outcome. */
  async function runAttempt(
    claim: ReactionOutboxClaim<TPayload>,
    failures: ReactionOutboxFailure[],
  ) {
    await notify({ type: 'attempt-started', claim })
    const context: ReactionOutboxAttemptContext = {
      jobId: claim.id,
      idempotencyKey: claim.idempotencyKey,
      requestedAt: claim.requestedAt,
      attemptId: claim.activeAttemptId,
      attemptNumber: claim.attemptCount,
      signal,
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
      if (cause instanceof ReactionOutboxLeaseLostError) return
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
          if (deadLetterCause instanceof ReactionOutboxLeaseLostError) return
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
        return
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
        if (rescheduleCause instanceof ReactionOutboxLeaseLostError) return
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

  async function runDrain() {
    const failures: ReactionOutboxFailure[] = []
    const running = new Set<Promise<void>>()
    let fatal: { readonly cause: unknown } | undefined

    for (;;) {
      if (signal.aborted || fatal) break
      if (running.size < concurrency) {
        const claimTime = now()
        await Effect.runPromise(options.store.requeueExpired(claimTime))
        const claim = await Effect.runPromise(
          options.store.claimNext(
            claimTime,
            new Date(claimTime.getTime() + leaseMs),
          ),
        )
        if (claim) {
          const attempt: Promise<void> = runAttempt(claim, failures)
            .catch((cause) => {
              fatal ??= { cause }
            })
            .finally(() => running.delete(attempt))
          running.add(attempt)
          continue
        }
      }

      // At capacity, or nothing claimable now: wait for a running attempt to
      // end, for new work, or for the next work this Store knows of.
      const waits: Promise<unknown>[] = [...running]
      if (running.size < concurrency) {
        const nextWorkAt = await Effect.runPromise(options.store.nextWorkAt())
        if (!nextWorkAt && running.size === 0) break
        const delay = nextWorkAt
          ? Math.max(0, nextWorkAt.getTime() - now().getTime())
          : undefined
        if (delay === 0) continue
        const ended = new AbortController()
        waits.push(
          delay === undefined
            ? waitForWork(maxTimerMs, { signal: ended.signal })
            : waitForWork(delay, {
                sleep: options.sleep,
                signal: ended.signal,
              }),
        )
        await Promise.race(waits)
        ended.abort()
      } else {
        await Promise.race(waits)
      }
    }

    // A stopping drain lets running attempts record their outcome.
    await Promise.allSettled([...running])
    if (fatal) throw fatal.cause
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
    close() {
      lifecycle.abort()
    },
    signal,
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
  const stopped = () => options.signal?.aborted || worker.signal.aborted
  while (!stopped()) {
    try {
      await worker.drain()
    } catch (cause) {
      if (!options.onError) throw cause
      await options.onError(cause)
    }
    if (stopped()) break
    await worker.waitForWork(pollIntervalMs, {
      sleep: options.sleep,
      signal: options.signal,
    })
  }
}
