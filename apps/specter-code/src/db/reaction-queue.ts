import type { ReactionScheduler } from '@specter-ts/core'

import { getBoundSqliteDb } from './specter-sqlite'

export type SqliteReactionSchedulerOptions = {
  now?: () => Date
  staleRunningAfterMs?: number
}

type Waiter = {
  resolve: () => void
  reject: (cause: unknown) => void
}

const DEFAULT_STALE_RUNNING_AFTER_MS = 5 * 60 * 1_000

const errorSummary = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause)

export function createSqliteReactionScheduler(
  options: SqliteReactionSchedulerOptions = {},
): ReactionScheduler {
  const now = options.now ?? (() => new Date())
  const staleRunningAfterMs =
    options.staleRunningAfterMs ?? DEFAULT_STALE_RUNNING_AFTER_MS

  return (run) => {
    let runRequested = false
    let enqueueChain = Promise.resolve()
    let activeRun: Promise<void> | undefined
    let waiters: Waiter[] = []

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

    async function enqueueRequest() {
      const requestedAt = now().toISOString()
      await getBoundSqliteDb().execute({
        sql: `
          INSERT INTO specter_reaction_queue (
            id,
            status,
            requested_at,
            started_at,
            completed_at,
            error
          ) VALUES (?, 'requested', ?, NULL, NULL, NULL)
        `,
        args: [crypto.randomUUID(), requestedAt],
      })
    }

    async function requeueStaleRunningJobs() {
      const staleBefore = new Date(now().getTime() - staleRunningAfterMs).toISOString()
      await getBoundSqliteDb().execute({
        sql: `
          UPDATE specter_reaction_queue
          SET status = 'requested', started_at = NULL, error = NULL
          WHERE status = 'running'
            AND started_at IS NOT NULL
            AND started_at < ?
        `,
        args: [staleBefore],
      })
    }

    async function claimNextJob() {
      await requeueStaleRunningJobs()

      const result = await getBoundSqliteDb().execute({
        sql: `
          SELECT id
          FROM specter_reaction_queue
          WHERE status = 'requested'
          ORDER BY requested_at ASC, id ASC
          LIMIT 1
        `,
        args: [],
      })
      const id = result.rows[0]?.id
      if (typeof id !== 'string') return undefined

      await getBoundSqliteDb().execute({
        sql: `
          UPDATE specter_reaction_queue
          SET status = 'running', started_at = ?, completed_at = NULL, error = NULL
          WHERE id = ? AND status = 'requested'
        `,
        args: [now().toISOString(), id],
      })

      return id
    }

    async function markJobCompleted(id: string) {
      await getBoundSqliteDb().execute({
        sql: `
          UPDATE specter_reaction_queue
          SET status = 'completed', completed_at = ?, error = NULL
          WHERE id = ?
        `,
        args: [now().toISOString(), id],
      })
    }

    async function markJobFailed(id: string, cause: unknown) {
      await getBoundSqliteDb().execute({
        sql: `
          UPDATE specter_reaction_queue
          SET status = 'failed', completed_at = ?, error = ?
          WHERE id = ?
        `,
        args: [now().toISOString(), errorSummary(cause), id],
      })
    }

    async function drain() {
      try {
        do {
          runRequested = false
          await enqueueChain

          for (;;) {
            const jobId = await claimNextJob()
            if (!jobId) break

            try {
              await run()
              await markJobCompleted(jobId)
            } catch (cause) {
              await markJobFailed(jobId, cause)
              throw cause
            }
          }
        } while (runRequested)

        resolveWaiters()
      } catch (cause) {
        runRequested = false
        rejectWaiters(cause)
      } finally {
        activeRun = undefined
      }
    }

    return () => {
      runRequested = true
      enqueueChain = enqueueChain.then(enqueueRequest, enqueueRequest)

      if (!activeRun) activeRun = drain()

      return () => {
        if (!activeRun && !runRequested) return Promise.resolve()

        return new Promise<void>((resolve, reject) => {
          waiters.push({ resolve, reject })
        })
      }
    }
  }
}
