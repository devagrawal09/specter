import { createClient } from '@libsql/client'
import { Effect } from 'effect'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createSqliteReactionSchedulerService,
  prepareSqliteReactionScheduler,
} from './reaction-scheduler'

const clients: ReturnType<typeof createClient>[] = []
const directories: string[] = []

afterEach(() => {
  for (const client of clients.splice(0)) client.close()
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'specter-scheduler-'))
  directories.push(directory)
  const url = `file:${join(directory, 'specter.db')}`
  const first = createClient({ url })
  const second = createClient({ url })
  clients.push(first, second)
  await prepareSqliteReactionScheduler(first)
  await prepareSqliteReactionScheduler(second)
  return { first, second }
}

describe('SQLite Reaction scheduler', () => {
  it('keeps draining a rescheduled transient failure without another request', async () => {
    const { first } = await setup()
    let executions = 0
    const scheduler = createSqliteReactionSchedulerService(first, {
      retryIntervalMs: 1,
    })
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const bound = yield* scheduler.bind({
            execute: () =>
              Effect.gen(function* () {
                executions += 1
                if (executions === 1) return yield* Effect.fail('transient')
              }),
          })
          const completion = yield* bound.schedule(1)
          yield* completion
        }),
      ),
    )

    expect(executions).toBe(2)
  })

  it('atomically claims one boundary across runtime instances', async () => {
    const { first, second } = await setup()
    let executions = 0
    const execute = () =>
      Effect.gen(function* () {
        executions += 1
        yield* Effect.sleep('20 millis')
      })
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const firstBound = yield* createSqliteReactionSchedulerService(
            first,
            { pollIntervalMs: 1, retryIntervalMs: 1 },
          ).bind({ execute })
          const secondBound = yield* createSqliteReactionSchedulerService(
            second,
            { pollIntervalMs: 1, retryIntervalMs: 1 },
          ).bind({ execute })
          const completions = yield* Effect.all(
            [firstBound.schedule(2), secondBound.schedule(2)],
            { concurrency: 'unbounded' },
          )
          yield* Effect.all(completions, {
            concurrency: 'unbounded',
            discard: true,
          })
        }),
      ),
    )

    expect(executions).toBe(1)
  })

  it('rechecks a completed boundary so reset Slice cursors can rebuild', async () => {
    const { first } = await setup()
    let executions = 0
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const bound = yield* createSqliteReactionSchedulerService(first, {
            pollIntervalMs: 1,
            retryIntervalMs: 1,
          }).bind({
            execute: () =>
              Effect.sync(() => {
                executions += 1
              }),
          })
          const firstCompletion = yield* bound.schedule(3)
          yield* firstCompletion
          const secondCompletion = yield* bound.schedule(3)
          yield* secondCompletion
        }),
      ),
    )

    expect(executions).toBe(2)
  })

  it('persists a request before returning its completion Effect', async () => {
    const { first } = await setup()
    let releaseExecution: () => void = () => undefined
    const executionReleased = new Promise<void>((resolve) => {
      releaseExecution = resolve
    })
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const bound = yield* createSqliteReactionSchedulerService(first, {
            pollIntervalMs: 1,
            retryIntervalMs: 1,
          }).bind({
            execute: () => Effect.promise(() => executionReleased),
          })
          const completion = yield* bound.schedule(4)
          const persisted = yield* Effect.promise(() =>
            first.execute({
              sql: `SELECT status FROM specter_reaction_scheduler
                WHERE through_order = ?`,
              args: [4],
            }),
          )

          expect(persisted.rows[0]?.status).toMatch(/pending|running/)

          releaseExecution()
          yield* completion
        }),
      ),
    )
  })

  it('claims work accepted by a failed runtime without another local schedule', async () => {
    const { first, second } = await setup()
    const requestedAt = new Date().toISOString()
    await first.execute({
      sql: `INSERT INTO specter_reaction_scheduler (
        through_order, status, scheduled_at, available_at
      ) VALUES (?, 'pending', ?, ?)`,
      args: [5, requestedAt, requestedAt],
    })
    let resolveExecution: () => void = () => undefined
    const executed = new Promise<void>((resolve) => {
      resolveExecution = resolve
    })

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* createSqliteReactionSchedulerService(second, {
            pollIntervalMs: 1,
            retryIntervalMs: 1,
          }).bind({
            execute: ({ throughOrder }) =>
              Effect.sync(() => {
                expect(throughOrder).toBe(5)
                resolveExecution()
              }),
          })
          yield* Effect.promise(() => executed).pipe(Effect.timeout('1 second'))
        }),
      ),
    )

    const persisted = await second.execute({
      sql: `SELECT status FROM specter_reaction_scheduler
        WHERE through_order = ?`,
      args: [5],
    })
    expect(persisted.rows[0]?.status).toBe('completed')
  })
})
