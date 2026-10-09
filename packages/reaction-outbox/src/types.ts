export type ReactionOutboxStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'dead-letter'

export type ReactionOutboxJob<TPayload = unknown> = {
  readonly id: string
  readonly idempotencyKey: string
  /**
   * Jobs with the same key never run at the same time, and run in the order a
   * Store claims them. Only Stores with `concurrencyKeys` honor it.
   */
  readonly concurrencyKey?: string
  readonly payload: TPayload
  readonly status: ReactionOutboxStatus
  readonly requestedAt: Date
  readonly availableAt: Date
  readonly attemptCount: number
  readonly activeAttemptId?: string
  readonly leaseExpiresAt?: Date
  readonly completedAt?: Date
  readonly lastError?: string
}

export type ReactionOutboxClaim<TPayload = unknown> =
  ReactionOutboxJob<TPayload> & {
    readonly status: 'running'
    readonly activeAttemptId: string
    readonly leaseExpiresAt: Date
  }

export type EnqueueReactionInput<TPayload> = {
  readonly id: string
  readonly idempotencyKey: string
  readonly concurrencyKey?: string
  readonly payload: TPayload
  readonly requestedAt: Date
  readonly availableAt: Date
}

export type EnqueueReactionResult<TPayload> = {
  readonly job: ReactionOutboxJob<TPayload>
  readonly created: boolean
}

export type ReactionOutboxStore<TPayload = unknown> = {
  /**
   * The Store keeps each job's `concurrencyKey` and `claimNext` never claims a
   * job while another job with the same key is running. A worker may run
   * several attempts at once only over such a Store.
   */
  readonly concurrencyKeys?: true
  enqueue(
    input: EnqueueReactionInput<TPayload>,
  ): Effect.Effect<EnqueueReactionResult<TPayload>, unknown>
  claimNext(
    now: Date,
    leaseExpiresAt: Date,
  ): Effect.Effect<ReactionOutboxClaim<TPayload> | undefined, unknown>
  complete(
    jobId: string,
    attemptId: string,
    completedAt: Date,
  ): Effect.Effect<void, unknown>
  reschedule(
    jobId: string,
    attemptId: string,
    availableAt: Date,
    error: string,
  ): Effect.Effect<void, unknown>
  deadLetter(
    jobId: string,
    attemptId: string,
    failedAt: Date,
    error: string,
  ): Effect.Effect<void, unknown>
  requeueExpired(now: Date): Effect.Effect<number, unknown>
  nextWorkAt(): Effect.Effect<Date | undefined, unknown>
  get(
    jobId: string,
  ): Effect.Effect<ReactionOutboxJob<TPayload> | undefined, unknown>
  list(
    status?: ReactionOutboxStatus,
  ): Effect.Effect<readonly ReactionOutboxJob<TPayload>[], unknown>
  retryDeadLetter(
    jobId: string,
    availableAt: Date,
  ): Effect.Effect<void, unknown>
  /**
   * Optional. Moves an active attempt's lease to `leaseExpiresAt`. The worker
   * calls it periodically while a handler runs so a slow attempt is not
   * requeued. Fails with `ReactionOutboxLeaseLostError` when the attempt is no
   * longer active. Without it, an attempt keeps the lease it was claimed with.
   */
  renewLease?(
    jobId: string,
    attemptId: string,
    leaseExpiresAt: Date,
  ): Effect.Effect<void, unknown>
  /**
   * Optional in-process wake-up. Calls `listener` after this Store instance
   * makes new work claimable, so workers in the same process start it without
   * waiting for their poll interval. Returns an unsubscribe function. Workers
   * in other processes still find the work by polling.
   */
  subscribe?(listener: () => void): () => void
}

export type ReactionOutboxAttemptContext = {
  readonly jobId: string
  readonly idempotencyKey: string
  readonly requestedAt: Date
  readonly attemptId: string
  readonly attemptNumber: number
}

export type ReactionOutboxTransition<TPayload = unknown> =
  | {
      readonly type: 'enqueued'
      readonly job: ReactionOutboxJob<TPayload>
      readonly created: boolean
    }
  | {
      readonly type: 'attempt-started'
      readonly claim: ReactionOutboxClaim<TPayload>
    }
  | {
      readonly type: 'attempt-completed'
      readonly claim: ReactionOutboxClaim<TPayload>
      readonly completedAt: Date
    }
  | {
      readonly type: 'attempt-retrying'
      readonly claim: ReactionOutboxClaim<TPayload>
      readonly availableAt: Date
      readonly error: string
    }
  | {
      readonly type: 'dead-lettered'
      readonly claim: ReactionOutboxClaim<TPayload>
      readonly failedAt: Date
      readonly error: string
    }
  | {
      /**
       * A heartbeat could not renew the attempt's lease. A lost lease stops
       * heartbeats; other failures retry on the next beat.
       */
      readonly type: 'lease-renewal-failed'
      readonly claim: ReactionOutboxClaim<TPayload>
      readonly leaseLost: boolean
      readonly error: string
    }
  | {
      readonly type: 'dead-letter-retried'
      readonly jobId: string
      readonly availableAt: Date
    }

export type ReactionOutboxTransitionListener<TPayload = unknown> = (
  transition: ReactionOutboxTransition<TPayload>,
) => Promise<void> | void
import type { Effect } from 'effect'
