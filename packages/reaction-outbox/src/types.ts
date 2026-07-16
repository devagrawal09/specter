export type ReactionOutboxStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'dead-letter'

export type ReactionOutboxJob<TPayload = unknown> = {
  readonly id: string
  readonly idempotencyKey: string
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
  readonly payload: TPayload
  readonly requestedAt: Date
  readonly availableAt: Date
}

export type EnqueueReactionResult<TPayload> = {
  readonly job: ReactionOutboxJob<TPayload>
  readonly created: boolean
}

export type ReactionOutboxStore<TPayload = unknown> = {
  enqueue(
    input: EnqueueReactionInput<TPayload>,
  ): Promise<EnqueueReactionResult<TPayload>>
  claimNext(
    now: Date,
    leaseExpiresAt: Date,
  ): Promise<ReactionOutboxClaim<TPayload> | undefined>
  complete(jobId: string, attemptId: string, completedAt: Date): Promise<void>
  reschedule(
    jobId: string,
    attemptId: string,
    availableAt: Date,
    error: string,
  ): Promise<void>
  deadLetter(
    jobId: string,
    attemptId: string,
    failedAt: Date,
    error: string,
  ): Promise<void>
  requeueExpired(now: Date): Promise<number>
  nextWorkAt(): Promise<Date | undefined>
  get(jobId: string): Promise<ReactionOutboxJob<TPayload> | undefined>
  list(
    status?: ReactionOutboxStatus,
  ): Promise<readonly ReactionOutboxJob<TPayload>[]>
  retryDeadLetter(jobId: string, availableAt: Date): Promise<void>
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
      readonly type: 'dead-letter-retried'
      readonly jobId: string
      readonly availableAt: Date
    }

export type ReactionOutboxTransitionListener<TPayload = unknown> = (
  transition: ReactionOutboxTransition<TPayload>,
) => Promise<void> | void
