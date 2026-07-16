import type {
  EnqueueReactionInput,
  EnqueueReactionResult,
  ReactionOutboxClaim,
  ReactionOutboxJob,
  ReactionOutboxStatus,
  ReactionOutboxStore,
} from './types'
import { ReactionOutboxLeaseLostError } from './errors'

export type MemoryReactionOutboxStore<TPayload> =
  ReactionOutboxStore<TPayload> & {
    reset(): void
  }

export function createMemoryReactionOutboxStore<
  TPayload,
>(): MemoryReactionOutboxStore<TPayload> {
  const jobs = new Map<string, ReactionOutboxJob<TPayload>>()
  const idsByIdempotencyKey = new Map<string, string>()

  function copyJob<TJob extends ReactionOutboxJob<TPayload>>(job: TJob): TJob {
    return {
      ...job,
      requestedAt: new Date(job.requestedAt),
      availableAt: new Date(job.availableAt),
      leaseExpiresAt: job.leaseExpiresAt
        ? new Date(job.leaseExpiresAt)
        : undefined,
      completedAt: job.completedAt ? new Date(job.completedAt) : undefined,
    } as TJob
  }

  function requireActiveAttempt(jobId: string, attemptId: string) {
    const job = jobs.get(jobId)
    if (!job) throw new Error(`Unknown Reaction outbox job: ${jobId}`)
    if (job.status !== 'running' || job.activeAttemptId !== attemptId) {
      throw new ReactionOutboxLeaseLostError(attemptId)
    }
    return job
  }

  return {
    async enqueue(
      input: EnqueueReactionInput<TPayload>,
    ): Promise<EnqueueReactionResult<TPayload>> {
      const existingId = idsByIdempotencyKey.get(input.idempotencyKey)
      if (existingId) {
        const existing = jobs.get(existingId)
        if (!existing)
          throw new Error('Corrupt Reaction outbox idempotency index')
        return { job: copyJob(existing), created: false }
      }
      if (jobs.has(input.id)) {
        throw new Error(`Duplicate Reaction outbox job id: ${input.id}`)
      }

      const job: ReactionOutboxJob<TPayload> = {
        ...input,
        status: 'pending',
        attemptCount: 0,
      }
      jobs.set(job.id, job)
      idsByIdempotencyKey.set(job.idempotencyKey, job.id)
      return { job: copyJob(job), created: true }
    },

    async claimNext(now, leaseExpiresAt) {
      const job = [...jobs.values()]
        .filter(
          (candidate) =>
            candidate.status === 'pending' &&
            candidate.availableAt.getTime() <= now.getTime(),
        )
        .sort(
          (left, right) =>
            left.availableAt.getTime() - right.availableAt.getTime() ||
            left.requestedAt.getTime() - right.requestedAt.getTime() ||
            left.id.localeCompare(right.id),
        )[0]
      if (!job) return undefined

      const attemptCount = job.attemptCount + 1
      const claim: ReactionOutboxClaim<TPayload> = {
        ...job,
        status: 'running',
        attemptCount,
        activeAttemptId: `${job.id}:attempt:${attemptCount}`,
        leaseExpiresAt,
      }
      jobs.set(job.id, claim)
      return copyJob(claim)
    },

    async complete(jobId, attemptId, completedAt) {
      const job = requireActiveAttempt(jobId, attemptId)
      jobs.set(jobId, {
        ...job,
        status: 'completed',
        activeAttemptId: undefined,
        leaseExpiresAt: undefined,
        completedAt,
        lastError: undefined,
      })
    },

    async reschedule(jobId, attemptId, availableAt, error) {
      const job = requireActiveAttempt(jobId, attemptId)
      jobs.set(jobId, {
        ...job,
        status: 'pending',
        availableAt,
        activeAttemptId: undefined,
        leaseExpiresAt: undefined,
        lastError: error,
      })
    },

    async deadLetter(jobId, attemptId, failedAt, error) {
      const job = requireActiveAttempt(jobId, attemptId)
      jobs.set(jobId, {
        ...job,
        status: 'dead-letter',
        activeAttemptId: undefined,
        leaseExpiresAt: undefined,
        completedAt: failedAt,
        lastError: error,
      })
    },

    async requeueExpired(now) {
      let count = 0
      for (const [id, job] of jobs) {
        if (
          job.status === 'running' &&
          job.leaseExpiresAt &&
          job.leaseExpiresAt.getTime() <= now.getTime()
        ) {
          jobs.set(id, {
            ...job,
            status: 'pending',
            availableAt: now,
            activeAttemptId: undefined,
            leaseExpiresAt: undefined,
            lastError: 'Reaction attempt lease expired',
          })
          count += 1
        }
      }
      return count
    },

    async nextWorkAt() {
      const wakeups = [...jobs.values()].flatMap((job) => {
        if (job.status === 'pending') return [job.availableAt]
        if (job.status === 'running' && job.leaseExpiresAt) {
          return [job.leaseExpiresAt]
        }
        return []
      })
      const next = wakeups.sort(
        (left, right) => left.getTime() - right.getTime(),
      )[0]
      return next ? new Date(next) : undefined
    },

    async get(jobId) {
      const job = jobs.get(jobId)
      return job ? copyJob(job) : undefined
    },

    async list(status?: ReactionOutboxStatus) {
      return [...jobs.values()]
        .filter((job) => !status || job.status === status)
        .sort(
          (left, right) =>
            left.requestedAt.getTime() - right.requestedAt.getTime() ||
            left.id.localeCompare(right.id),
        )
        .map(copyJob)
    },

    async retryDeadLetter(jobId, availableAt) {
      const job = jobs.get(jobId)
      if (!job) throw new Error(`Unknown Reaction outbox job: ${jobId}`)
      if (job.status !== 'dead-letter') {
        throw new Error(`Reaction outbox job is not dead-lettered: ${jobId}`)
      }
      jobs.set(jobId, {
        ...job,
        status: 'pending',
        availableAt,
        completedAt: undefined,
        lastError: undefined,
      })
    },

    reset() {
      jobs.clear()
      idsByIdempotencyKey.clear()
    },
  }
}
