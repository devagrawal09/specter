import { createClient } from '@libsql/client'
import {
  createReactionOutboxWorker,
  ReactionOutboxDrainFailure,
} from '../../reaction-outbox/src/index'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createSqliteReactionOutboxStore,
  prepareSqliteReactionOutbox,
} from './reaction-outbox'

const clients: ReturnType<typeof createClient>[] = []
const tempDirectories: string[] = []

afterEach(() => {
  for (const client of clients.splice(0)) client.close()
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'specter-sqlite-outbox-'))
  tempDirectories.push(directory)
  const client = createClient({ url: `file:${join(directory, 'outbox.db')}` })
  clients.push(client)
  await prepareSqliteReactionOutbox(client)
  return {
    client,
    store: createSqliteReactionOutboxStore<{ task: string }>(client),
  }
}

describe('SQLite Reaction outbox', () => {
  it('persists idempotent jobs across store instances', async () => {
    const { client, store } = await setup()
    const input = {
      id: 'job-1',
      idempotencyKey: 'email-1',
      payload: { task: 'send-email' },
      requestedAt: new Date(0),
      availableAt: new Date(0),
    }
    await Effect.runPromise(store.enqueue(input))
    const restarted = createSqliteReactionOutboxStore<{ task: string }>(client)
    const duplicate = await Effect.runPromise(
      restarted.enqueue({ ...input, id: 'job-2' }),
    )

    expect(duplicate.created).toBe(false)
    expect(duplicate.job).toMatchObject({ id: 'job-1', status: 'pending' })
  })

  it('supports custom payload codecs', async () => {
    const { client } = await setup()
    const store = createSqliteReactionOutboxStore<{ value: bigint }>(client, {
      codec: {
        encode: (payload) => payload.value.toString(),
        decode: (payload) => ({ value: BigInt(payload) }),
      },
    })
    await Effect.runPromise(
      store.enqueue({
        id: 'job-1',
        idempotencyKey: 'job-1',
        payload: { value: 42n },
        requestedAt: new Date(0),
        availableAt: new Date(0),
      }),
    )

    expect(await Effect.runPromise(store.get('job-1'))).toMatchObject({
      payload: { value: 42n },
    })
  })

  it('atomically claims one job and requeues expired attempt leases', async () => {
    const { store } = await setup()
    await Effect.runPromise(
      store.enqueue({
        id: 'job-1',
        idempotencyKey: 'job-1',
        payload: { task: 'work' },
        requestedAt: new Date(0),
        availableAt: new Date(0),
      }),
    )

    const [first, second] = await Promise.all([
      Effect.runPromise(store.claimNext(new Date(0), new Date(10))),
      Effect.runPromise(store.claimNext(new Date(0), new Date(10))),
    ])

    expect([first, second].filter(Boolean)).toHaveLength(1)
    expect(await Effect.runPromise(store.requeueExpired(new Date(10)))).toBe(1)
    expect(
      await Effect.runPromise(store.claimNext(new Date(10), new Date(20))),
    ).toMatchObject({
      id: 'job-1',
      activeAttemptId: 'job-1:attempt:2',
    })
  })

  it('supports retries, dead-letter inspection, and explicit replay', async () => {
    const { store } = await setup()
    let succeeds = false
    const worker = createReactionOutboxWorker({
      store,
      maxAttempts: 1,
      idFactory: () => 'job-1',
      now: () => new Date(0),
      handle: async () => {
        if (!succeeds) throw new Error('provider unavailable')
      },
    })
    await worker.enqueue({ task: 'send-email' })
    await expect(worker.drain()).rejects.toBeInstanceOf(
      ReactionOutboxDrainFailure,
    )
    expect(await Effect.runPromise(store.list('dead-letter'))).toHaveLength(1)

    succeeds = true
    await worker.retryDeadLetter('job-1', new Date(0))
    await worker.drain()

    expect(await Effect.runPromise(store.get('job-1'))).toMatchObject({
      status: 'completed',
      attemptCount: 2,
    })
  })
})
