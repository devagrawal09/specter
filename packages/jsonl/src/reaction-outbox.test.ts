import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createReactionOutboxWorker,
  type OutboxedReaction,
  ReactionOutboxDrainFailure,
  ReactionOutboxLeaseLostError,
  runReactionOutboxWorker,
  withReactionOutbox,
} from '@specter-ts/reaction-outbox'
import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'

import { createJsonlEventLog } from './event-log'
import {
  createJsonlReactionOutboxStore,
  type JsonlReactionOutboxStore,
} from './reaction-outbox'

const directories: string[] = []
const stores: JsonlReactionOutboxStore<never>[] = []

function temporaryOutboxPath() {
  const directory = mkdtempSync(join(tmpdir(), 'specter-jsonl-outbox-'))
  directories.push(directory)
  return join(directory, 'nested', 'outbox.jsonl')
}

function open<TPayload = { task: string }>(
  options: Parameters<typeof createJsonlReactionOutboxStore<TPayload>>[0],
) {
  const store = createJsonlReactionOutboxStore<TPayload>(options)
  stores.push(store as unknown as JsonlReactionOutboxStore<never>)
  return store
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close()
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

const job = (id: string, idempotencyKey = id) => ({
  id,
  idempotencyKey,
  payload: { task: id },
  requestedAt: new Date(0),
  availableAt: new Date(0),
})

const run = Effect.runPromise

describe.each([
  ['without fsync', false],
  ['with fsync', true],
])('JSONL Reaction outbox %s', (_name, fsync) => {
  it('persists idempotent jobs across reopen', async () => {
    const path = temporaryOutboxPath()
    const store = open({ path, fsync })
    expect((await run(store.enqueue(job('job-1', 'email-1')))).created).toBe(
      true,
    )
    store.close()

    const reopened = open({ path, fsync })
    const duplicate = await run(reopened.enqueue(job('job-2', 'email-1')))

    expect(duplicate.created).toBe(false)
    expect(duplicate.job).toMatchObject({
      id: 'job-1',
      status: 'pending',
      payload: { task: 'job-1' },
    })
    expect(await run(reopened.list())).toHaveLength(1)
  })

  it('atomically claims one job and requeues expired attempt leases', async () => {
    const store = open({ path: temporaryOutboxPath(), fsync })
    await run(store.enqueue(job('job-1')))

    const [first, second] = await Promise.all([
      run(store.claimNext(new Date(0), new Date(10))),
      run(store.claimNext(new Date(0), new Date(10))),
    ])

    expect([first, second].filter(Boolean)).toHaveLength(1)
    expect(await run(store.nextWorkAt())).toEqual(new Date(10))
    expect(await run(store.requeueExpired(new Date(9)))).toBe(0)
    expect(await run(store.requeueExpired(new Date(10)))).toBe(1)
    expect(await run(store.get('job-1'))).toMatchObject({
      status: 'pending',
      lastError: 'Reaction attempt lease expired',
    })
    expect(
      await run(store.claimNext(new Date(10), new Date(20))),
    ).toMatchObject({
      id: 'job-1',
      status: 'running',
      attemptCount: 2,
      activeAttemptId: 'job-1:attempt:2',
      leaseExpiresAt: new Date(20),
    })
  })

  it('claims available jobs in availability order', async () => {
    const store = open({ path: temporaryOutboxPath(), fsync })
    await run(store.enqueue({ ...job('late'), availableAt: new Date(5) }))
    await run(store.enqueue({ ...job('b'), availableAt: new Date(1) }))
    await run(store.enqueue({ ...job('a'), availableAt: new Date(1) }))

    const claimed: (string | undefined)[] = []
    for (let index = 0; index < 4; index += 1) {
      claimed.push((await run(store.claimNext(new Date(2), new Date(9))))?.id)
    }

    expect(claimed).toEqual(['a', 'b', undefined, undefined])
    expect(await run(store.nextWorkAt())).toEqual(new Date(5))
  })

  it('rejects transitions from an attempt that lost its lease', async () => {
    const store = open({ path: temporaryOutboxPath(), fsync })
    await run(store.enqueue(job('job-1')))
    const first = await run(store.claimNext(new Date(0), new Date(10)))
    await run(store.requeueExpired(new Date(10)))
    const second = await run(store.claimNext(new Date(10), new Date(20)))
    const stale = first?.activeAttemptId ?? 'missing'

    for (const transition of [
      store.complete('job-1', stale, new Date(11)),
      store.reschedule('job-1', stale, new Date(11), 'late'),
      store.deadLetter('job-1', stale, new Date(11), 'late'),
      store.renewLease('job-1', stale, new Date(30)),
      store.complete('unknown', stale, new Date(11)),
    ]) {
      await expect(run(transition)).rejects.toBeInstanceOf(
        ReactionOutboxLeaseLostError,
      )
    }
    await run(
      store.complete('job-1', second?.activeAttemptId ?? '', new Date(12)),
    )
    expect(await run(store.get('job-1'))).toMatchObject({
      status: 'completed',
      completedAt: new Date(12),
    })
  })

  it('renews the lease of the active attempt', async () => {
    const store = open({ path: temporaryOutboxPath(), fsync })
    await run(store.enqueue(job('job-1')))
    const claim = await run(store.claimNext(new Date(0), new Date(10)))
    await run(
      store.renewLease('job-1', claim?.activeAttemptId ?? '', new Date(50)),
    )

    expect(await run(store.requeueExpired(new Date(10)))).toBe(0)
    expect(await run(store.get('job-1'))).toMatchObject({
      status: 'running',
      leaseExpiresAt: new Date(50),
    })
  })

  it('supports retries, dead-letter inspection, and explicit replay', async () => {
    const path = temporaryOutboxPath()
    const store = open({ path, fsync })
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
    expect(await run(store.list('dead-letter'))).toMatchObject([
      { id: 'job-1', lastError: 'provider unavailable' },
    ])
    await expect(
      run(store.retryDeadLetter('missing', new Date(0))),
    ).rejects.toThrow('not dead-lettered')

    succeeds = true
    await worker.retryDeadLetter('job-1', new Date(0))
    await worker.drain()

    expect(await run(store.get('job-1'))).toMatchObject({
      status: 'completed',
      attemptCount: 2,
    })
    store.close()
    expect(await run(open({ path, fsync }).get('job-1'))).toMatchObject({
      status: 'completed',
      attemptCount: 2,
      lastError: undefined,
    })
  })

  it('supports custom payload codecs', async () => {
    const path = temporaryOutboxPath()
    const codec = {
      encode: (payload: { value: bigint }) => payload.value.toString(),
      decode: (encoded: unknown) => ({ value: BigInt(encoded as string) }),
    }
    const store = open<{ value: bigint }>({ path, fsync, codec })
    await run(
      store.enqueue({
        ...job('job-1'),
        payload: { value: 42n },
      }),
    )
    store.close()

    expect(
      await run(open<{ value: bigint }>({ path, fsync, codec }).get('job-1')),
    ).toMatchObject({ payload: { value: 42n } })
  })
})

describe('JSONL Reaction outbox file', () => {
  it('returns copies that callers cannot change', async () => {
    const store = open({ path: temporaryOutboxPath() })
    const { job: created } = await run(store.enqueue(job('job-1')))
    created.payload.task = 'changed'
    created.requestedAt.setTime(99)

    expect(await run(store.get('job-1'))).toMatchObject({
      payload: { task: 'job-1' },
      requestedAt: new Date(0),
    })
  })

  it('rejects a payload that JSON cannot represent without writing', async () => {
    const path = temporaryOutboxPath()
    const store = open<unknown>({ path })
    await expect(
      run(store.enqueue({ ...job('job-1'), payload: () => 'not json' })),
    ).rejects.toThrow('JSON-serializable')
    await expect(
      run(store.enqueue({ ...job('job-1'), payload: undefined })),
    ).rejects.toThrow('JSON-serializable')

    expect(readFileSync(path, 'utf8')).toBe('')
    expect(await run(store.list())).toEqual([])
  })

  it('rejects a reused job id under another idempotency key', async () => {
    const store = open({ path: temporaryOutboxPath() })
    await run(store.enqueue(job('job-1', 'key-1')))
    await expect(run(store.enqueue(job('job-1', 'key-2')))).rejects.toThrow(
      'Duplicate Reaction outbox job id',
    )
  })

  it('writes one transition per line', async () => {
    const path = temporaryOutboxPath()
    const store = open({ path })
    await run(store.enqueue(job('job-1')))
    const claim = await run(store.claimNext(new Date(0), new Date(10)))
    await run(
      store.complete('job-1', claim?.activeAttemptId ?? '', new Date(5)),
    )

    expect(
      readFileSync(path, 'utf8')
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line)),
    ).toEqual([
      {
        type: 'enqueued',
        id: 'job-1',
        idempotencyKey: 'job-1',
        payload: { task: 'job-1' },
        requestedAt: '1970-01-01T00:00:00.000Z',
        availableAt: '1970-01-01T00:00:00.000Z',
      },
      {
        type: 'claimed',
        id: 'job-1',
        attemptId: 'job-1:attempt:1',
        attemptCount: 1,
        leaseExpiresAt: '1970-01-01T00:00:00.010Z',
      },
      {
        type: 'completed',
        id: 'job-1',
        attemptId: 'job-1:attempt:1',
        completedAt: '1970-01-01T00:00:00.005Z',
      },
    ])
  })

  it('keeps completed jobs so a replayed delivery stays a no-op after reopen', async () => {
    const path = temporaryOutboxPath()
    const store = open({ path })
    await run(store.enqueue(job('notify:1')))
    const claim = await run(store.claimNext(new Date(0), new Date(10)))
    await run(
      store.complete('notify:1', claim?.activeAttemptId ?? '', new Date(1)),
    )
    store.close()

    const reopened = open({ path })
    const replayed = await run(
      reopened.enqueue({ ...job('notify:1'), payload: { task: 'other' } }),
    )

    expect(replayed).toMatchObject({
      created: false,
      job: { status: 'completed', payload: { task: 'notify:1' } },
    })
    expect(await run(reopened.claimNext(new Date(9), new Date(20)))).toBe(
      undefined,
    )
  })

  it('reads a completed job payload back from its enqueued line', async () => {
    const path = temporaryOutboxPath()
    const store = open<{ task: string }>({ path })
    // Multi-byte text checks that line locations count bytes.
    await run(store.enqueue({ ...job('é-1'), payload: { task: 'héllo ✓' } }))
    await run(store.enqueue({ ...job('job-2'), payload: { task: 'ünïcode' } }))
    for (let index = 0; index < 2; index += 1) {
      const claim = await run(store.claimNext(new Date(0), new Date(10)))
      await run(
        store.complete(
          claim?.id ?? '',
          claim?.activeAttemptId ?? '',
          new Date(1),
        ),
      )
    }

    const expected = [
      { id: 'é-1', status: 'completed', payload: { task: 'héllo ✓' } },
      { id: 'job-2', status: 'completed', payload: { task: 'ünïcode' } },
    ]
    expect(await run(store.list())).toMatchObject(expected)
    expect(await run(store.enqueue(job('job-2')))).toMatchObject({
      created: false,
      job: { payload: { task: 'ünïcode' } },
    })
    store.close()
    expect(await run(open<{ task: string }>({ path }).list())).toMatchObject(
      expected,
    )
  })

  it('releases attempts a previous open left running', async () => {
    const path = temporaryOutboxPath()
    const store = open({ path })
    await run(store.enqueue(job('running')))
    await run(store.enqueue({ ...job('waiting'), availableAt: new Date(50) }))
    const crashed = await run(
      store.claimNext(new Date(0), new Date(60 * 60 * 1_000)),
    )
    // The process exits without completing the attempt.
    store.close()

    const reopened = open({ path, now: () => new Date(7) })

    expect(reopened.releasedOnOpen).toEqual(['running'])
    expect(await run(reopened.get('running'))).toMatchObject({
      status: 'pending',
      availableAt: new Date(7),
      attemptCount: 1,
      activeAttemptId: undefined,
      leaseExpiresAt: undefined,
      lastError: expect.stringContaining('interrupted'),
    })
    expect(await run(reopened.get('waiting'))).toMatchObject({
      status: 'pending',
      availableAt: new Date(50),
    })
    await expect(
      run(
        reopened.complete(
          'running',
          crashed?.activeAttemptId ?? '',
          new Date(8),
        ),
      ),
    ).rejects.toBeInstanceOf(ReactionOutboxLeaseLostError)
    // The release is itself journaled, so the next open has nothing to do.
    reopened.close()
    const again = open({ path })
    expect(again.releasedOnOpen).toEqual([])
    expect(await run(again.claimNext(new Date(7), new Date(17)))).toMatchObject(
      { id: 'running', activeAttemptId: 'running:attempt:2' },
    )
  })

  it('keeps a last transition whose newline was lost', async () => {
    const path = temporaryOutboxPath()
    const store = open({ path })
    await run(store.enqueue(job('job-1')))
    store.close()
    const line = JSON.stringify({
      type: 'retried',
      id: 'job-1',
      availableAt: '1970-01-01T00:00:00.000Z',
    })
    // A whole line without its newline is only valid when it applies.
    appendFileSync(path, line)
    expect(() => open({ path })).toThrow('line 2 is malformed')
    expect(existsSync(`${path}.lock`)).toBe(false)

    writeFileSync(
      path,
      readFileSync(path, 'utf8').replace(
        line,
        JSON.stringify({
          type: 'enqueued',
          id: 'job-2',
          idempotencyKey: 'job-2',
          payload: { task: 'job-2' },
          requestedAt: '1970-01-01T00:00:00.000Z',
          availableAt: '1970-01-01T00:00:00.000Z',
        }),
      ),
    )
    const content = readFileSync(path, 'utf8')
    const reopened = open({ path })

    expect(reopened.discardedTrailingBytes).toBe(0)
    expect(readFileSync(path, 'utf8')).toBe(`${content}\n`)
    expect((await run(reopened.list())).map((entry) => entry.id)).toEqual([
      'job-1',
      'job-2',
    ])
  })

  it('removes an interrupted trailing write', async () => {
    const path = temporaryOutboxPath()
    const store = open({ path })
    await run(store.enqueue(job('job-1')))
    store.close()
    const content = readFileSync(path, 'utf8')
    appendFileSync(path, '{"type":"enqueued","id":"job-2","idem')

    const reopened = open({ path })

    expect(reopened.discardedTrailingBytes).toBeGreaterThan(0)
    expect(readFileSync(path, 'utf8')).toBe(content)
    expect(await run(reopened.list())).toHaveLength(1)
    await run(reopened.enqueue(job('job-2')))
    reopened.close()
    expect(await run(open({ path }).list())).toHaveLength(2)
  })

  it('fails to open a malformed journal without changing it', async () => {
    const path = temporaryOutboxPath()
    const store = open({ path })
    await run(store.enqueue(job('job-1')))
    store.close()
    const valid = readFileSync(path, 'utf8')

    for (const content of [
      `${valid}not json\n`,
      `${valid}{"type":"claimed","id":"job-1"}\n`,
      `${valid}{"type":"completed","id":"job-1","attemptId":"job-1:attempt:1","completedAt":"1970-01-01T00:00:00.000Z"}\n`,
      `${valid}${valid}`,
      `${valid}trailing garbage`,
    ]) {
      writeFileSync(path, content)
      expect(() => open({ path })).toThrow(/JSONL Reaction outbox/)
      expect(readFileSync(path, 'utf8')).toBe(content)
      expect(existsSync(`${path}.lock`)).toBe(false)
    }
  })
})

describe('JSONL Reaction outbox lock', () => {
  it('allows one open per path and releases the lock on close', () => {
    const path = temporaryOutboxPath()
    const store = open({ path })

    expect(existsSync(`${path}.lock`)).toBe(true)
    expect(() => open({ path })).toThrow(/already open/)
    store.close()
    store.close()
    expect(existsSync(`${path}.lock`)).toBe(false)
    open({ path })
  })

  it('reports a stale lock file without taking it over', () => {
    const path = temporaryOutboxPath()
    open({ path }).close()
    writeFileSync(`${path}.lock`, '999999\n')

    expect(() => open({ path })).toThrow(`${path}.lock`)
    expect(readFileSync(`${path}.lock`, 'utf8')).toBe('999999\n')
  })

  it('shares the Event Log lock, so one file cannot be opened as both', () => {
    const path = temporaryOutboxPath()
    const eventLog = createJsonlEventLog({ path })
    try {
      expect(() => open({ path })).toThrow(
        /already open in this process as a JSONL Event Log/,
      )
    } finally {
      eventLog.close()
    }
  })

  it('refuses transitions after close', async () => {
    const store = open({ path: temporaryOutboxPath() })
    store.close()
    await expect(run(store.enqueue(job('job-1')))).rejects.toThrow(/closed/)
  })
})

describe('JSONL Reaction outbox worker', () => {
  it('writes no lease renewal after the attempt completes', async () => {
    const path = temporaryOutboxPath()
    const store = open({ path })
    const worker = createReactionOutboxWorker({
      store,
      leaseMs: 1_000,
      heartbeatMs: 5,
      idFactory: () => 'job-1',
      handle: async () => {
        await new Promise((resolve) => setTimeout(resolve, 40))
      },
    })
    await worker.enqueue({ task: 'slow' })
    await worker.drain()
    await new Promise((resolve) => setTimeout(resolve, 30))

    const types = readFileSync(path, 'utf8')
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line).type)
    expect(types).toContain('renewed')
    expect(types.at(-1)).toBe('completed')
    worker.close()
  })

  it('records a running delivery before the Plugin scope closes', async () => {
    const path = temporaryOutboxPath()
    const store = open<OutboxedReaction<{ task: string }>>({ path })
    const handled: string[] = []
    const plugin = withReactionOutbox(
      () =>
        Effect.succeed((output: { task: string }) =>
          Effect.promise(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50))
            handled.push(output.task)
          }),
        ),
      { store },
    )
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const exec = yield* plugin(() => Effect.void)
          yield* exec(
            { task: 'reply' },
            {
              deliveryId: 'reply:1',
              throughOrder: 1,
              scheduledAt: new Date().toISOString(),
            },
          )
          yield* Effect.sleep('10 millis')
        }),
      ),
    )
    // As after app.close(): the Store closes once the worker stopped.
    store.close()

    const reopened = open<OutboxedReaction<{ task: string }>>({ path })
    expect(handled).toEqual(['reply'])
    expect(reopened.releasedOnOpen).toEqual([])
    expect(await run(reopened.get('reply:1'))).toMatchObject({
      status: 'completed',
    })
  })

  it('starts an enqueued job without waiting for the poll interval', async () => {
    const store = open({ path: temporaryOutboxPath() })
    const handled: string[] = []
    const controller = new AbortController()
    const worker = createReactionOutboxWorker({
      store,
      signal: controller.signal,
      handle: async (payload) => {
        handled.push(payload.task)
      },
    })
    const running = runReactionOutboxWorker(worker, {
      signal: controller.signal,
      pollIntervalMs: 60_000,
    })
    await new Promise((resolve) => setTimeout(resolve, 5))

    await run(store.enqueue({ ...job('job-1'), availableAt: new Date() }))
    const started = Date.now()
    while (handled.length === 0 && Date.now() - started < 1_000) {
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
    controller.abort()
    await running

    expect(handled).toEqual(['job-1'])
    expect(await run(store.get('job-1'))).toMatchObject({
      status: 'completed',
    })
  })
})
