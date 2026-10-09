import { ProjectID } from '@ocpp/schema/project-id'
import { SessionID } from '@ocpp/schema/session-id'
import { AbsolutePath } from '@ocpp/schema/schema'
import { createSpecterApp, EventLog } from '@specter-ts/core'
import { eventsFor } from '@specter-ts/core/testing'
import {
  createImmediateReactionSchedulerLayer,
  createMemoryEventLog,
} from '@specter-ts/memory'
import {
  createMemoryReactionOutboxStore,
  type OutboxedReaction,
} from '@specter-ts/reaction-outbox'
import { Effect, Exit, Layer, PubSub, Scope } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'

import { createSessionAppConfig, memorySliceStoreLayer } from './app.ts'
import { sessionEvent } from './events.ts'
import type { RunStepRequest } from './features/session/run-step-reaction/impl.ts'
import { type Delta, DeltaChannel } from './plugins/delta-channel.ts'
import { Model } from './plugins/model.ts'
import { modelStepHostLayer, StepHost } from './plugins/step-host.ts'
import { makeScriptedModel } from './plugins/scripted-model.ts'

// The real app, in process: memory Event Log, memory Slice stores, immediate
// Reaction scheduler, memory outbox store for the step Plugin, and the
// Model (scripted) + delta channel services the Plugin reads.
const boot = async (
  options: {
    readonly concurrency?: number
    // The host's compaction: the runtime's own model host has none.
    readonly compact?: StepHost['Service']['compact']
    // How many times the host asks to compact before a step.
    readonly compactFirst?: number
    readonly moving?: StepHost['Service']['moving']
    readonly recover?: StepHost['Service']['recover']
    readonly drive?: StepHost['Service']['drive']
    // Wraps the model host's begin.
    readonly begin?: (
      input: Parameters<StepHost['Service']['begin']>[0],
      begin: StepHost['Service']['begin'],
    ) => ReturnType<StepHost['Service']['begin']>
    // The outbox's wait before it retries a job that failed.
    readonly backoffMs?: (attempt: number) => number
  } = {},
) => {
  const log = createMemoryEventLog()
  await Effect.runPromise(
    log.append(
      ['ses_1', 'ses_2'].map((id) =>
        sessionEvent('session-created').create({
          sessionID: SessionID.make(id),
          projectID: ProjectID.make('prj_1'),
          location: { directory: AbsolutePath.make('/tmp/ws') },
          slug: `slug-${id}`,
          version: '2',
        }),
      ),
    ),
  )
  const model = makeScriptedModel()
  const pubsub = Effect.runSync(PubSub.unbounded<Delta>())
  const scope = Effect.runSync(Scope.make())
  const subscription = Effect.runSync(
    Scope.provide(PubSub.subscribe(pubsub), scope),
  )
  const outbox =
    createMemoryReactionOutboxStore<OutboxedReaction<RunStepRequest>>()

  const full = createSessionAppConfig(outbox, {
    worker: {
      ...(options.concurrency === undefined
        ? {}
        : { concurrency: options.concurrency }),
      ...(options.backoffMs === undefined
        ? {}
        : { backoffMs: options.backoffMs }),
    },
  })
  // Conformance wants every registered Event covered by a scenario, and the
  // 49-event catalog is mostly not ported yet: register the events the
  // registered Slices use (the union of their eventsFor).
  const events = [
    ...new Map(
      Object.values(full.slices)
        .flatMap((slice) => eventsFor(slice, full.events))
        .map((definition) => [definition.type, definition]),
    ).values(),
  ]
  const app = await createSpecterApp(
    { ...full, events },
    Layer.mergeAll(
      Layer.succeed(EventLog, log),
      memorySliceStoreLayer,
      createImmediateReactionSchedulerLayer(),
      Layer.effect(
        StepHost,
        Effect.map(StepHost, (host) => {
          let compactFirst = options.compactFirst ?? 0
          return StepHost.of({
            ...(options.moving ? { moving: options.moving } : {}),
            ...(options.recover ? { recover: options.recover } : {}),
            ...(options.drive ? { drive: options.drive } : {}),
            compact: options.compact ?? host.compact,
            begin: (input) =>
              compactFirst-- > 0
                ? Effect.succeed({ compact: true } as const)
                : options.begin
                  ? options.begin(input, host.begin)
                  : host.begin(input),
          })
        }),
      ).pipe(
        Layer.provide(
          modelStepHostLayer().pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(Model, model),
                Layer.succeed(DeltaChannel, { pubsub }),
              ),
            ),
          ),
        ),
      ),
    ),
  )

  const types = () =>
    log
      .inspect()
      .map((event) => event.type)
      .filter((type) => type !== 'session-created')
  const waitFor = async (condition: () => boolean | Promise<boolean>) => {
    const deadline = Date.now() + 2000
    while (!(await condition())) {
      if (Date.now() > deadline)
        throw new Error(
          `Timed out; events: ${log
            .inspect()
            .map(
              (event) =>
                `${event.type}:${(event.payload as { sessionID?: string }).sessionID}`,
            )
            .join(', ')}`,
        )
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
  // Jobs are drained by the outbox worker in the background; "settled" means
  // every queued step job finished (including stale ones that no-op).
  const outboxSettled = async () => {
    await waitFor(async () => {
      const jobs = await Effect.runPromise(outbox.list())
      return jobs.every((job) => job.status === 'completed')
    })
    return Effect.runPromise(outbox.list())
  }
  return {
    app,
    log,
    model,
    types,
    waitFor,
    outboxSettled,
    deltas: () => Effect.runSync(PubSub.takeAll(subscription)),
    close: async () => {
      await app.close()
      await Effect.runPromise(Scope.close(scope, Exit.void))
    },
  }
}

const gate = () => {
  let open!: () => void
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

const compactionItem = (inboxID: string) => ({
  type: 'enqueueInput' as const,
  payload: {
    sessionID: 'ses_1',
    inboxID,
    type: 'compaction' as const,
    payload: {},
  },
})

const enqueue = (
  inboxID: string,
  delivery?: 'steer' | 'queue',
  sessionID = 'ses_1',
) => ({
  type: 'enqueueInput' as const,
  payload: {
    sessionID,
    inboxID,
    type: 'user' as const,
    payload: { text: `prompt ${inboxID}` },
    ...(delivery ? { delivery } : {}),
  },
})

let running: Awaited<ReturnType<typeof boot>> | undefined
const start = async (options?: Parameters<typeof boot>[0]) => {
  running = await boot(options)
  return running
}
afterEach(async () => {
  await running?.close()
  running = undefined
})

describe('step loop with a scripted model', () => {
  it('runs a prompt through two steps and succeeds', async () => {
    const t = await start()
    t.model.script('ses_1', [
      { finish: 'tool-calls', text: 'thinking' },
      { finish: 'stop', text: 'done' },
    ])

    await t.app.command(enqueue('msg_a'))
    await t.waitFor(() => t.types().includes('session-execution-settled'))
    const jobs = await t.outboxSettled()

    expect(t.types()).toEqual([
      'session-inbox-enqueued',
      'session-execution-started',
      'session-inbox-delivered',
      'session-step-started',
      'session-block-recorded', // scripted text is durable now
      'session-step-settled',
      'session-step-started',
      'session-block-recorded',
      'session-step-settled',
      'session-execution-settled',
    ])
    expect(
      await t.app.query({
        type: 'executionStatus',
        payload: { sessionID: 'ses_1' },
      }),
    ).toEqual({ status: 'settled', executions: 1, lastOutcome: 'succeeded' })
    // The step after the last one was requested too (state-derived), then ran
    // as a no-op because the execution had already settled.
    expect(jobs.length).toBe(3)
    // Ephemeral deltas reach the side channel and never the Event Log.
    expect(t.deltas()).toEqual([
      { sessionID: 'ses_1', type: 'session.text.delta', text: 'thinking' },
      { sessionID: 'ses_1', type: 'session.text.delta', text: 'done' },
    ])
    expect(t.types().some((type) => type.includes('delta'))).toBe(false)
  })

  it('runs steps of different Sessions at once, one step per Session at a time', async () => {
    const t = await start({ concurrency: 2 })
    const first = gate()
    const second = gate()
    t.model.script('ses_1', [
      { finish: 'stop', text: 'one', gate: first.promise },
    ])
    t.model.script('ses_2', [
      { finish: 'stop', text: 'two', gate: second.promise },
    ])

    await t.app.command(enqueue('msg_a'))
    await t.app.command(enqueue('msg_b', undefined, 'ses_2'))
    // Both steps are in flight before either model call returns.
    await t.waitFor(
      () =>
        t.log.inspect().filter((event) => event.type === 'session-step-started')
          .length === 2,
    )
    second.open()
    await t.waitFor(() =>
      t.log
        .inspect()
        .some(
          (event) =>
            event.type === 'session-execution-settled' &&
            (event.payload as { sessionID: string }).sessionID === 'ses_2',
        ),
    )
    first.open()
    await t.waitFor(
      () =>
        t.log
          .inspect()
          .filter((event) => event.type === 'session-execution-settled')
          .length === 2,
    )
    await t.outboxSettled()
  })

  it('delivers a queued input once the execution is idle, within the same execution', async () => {
    const t = await start()
    const hold = gate()
    t.model.script('ses_1', [
      { finish: 'stop', text: 'first', gate: hold.promise },
      { finish: 'stop', text: 'second' },
    ])

    await t.app.command(enqueue('msg_a'))
    await t.waitFor(() => t.types().includes('session-step-started'))
    await t.app.command(enqueue('msg_b', 'queue'))
    hold.open()
    await t.waitFor(() => t.types().includes('session-execution-settled'))
    await t.outboxSettled()

    expect(t.types()).toEqual([
      'session-inbox-enqueued',
      'session-execution-started',
      'session-inbox-delivered', // A
      'session-step-started',
      'session-inbox-enqueued', // B waits for idle
      'session-block-recorded',
      'session-step-settled',
      'session-inbox-delivered', // B, at the idle boundary
      'session-step-started',
      'session-block-recorded',
      'session-step-settled',
      'session-execution-settled',
    ])
  })

  it('compacts when a compaction item is delivered, and finishes when nothing else waits', async () => {
    const compactions: unknown[] = []
    const t = await start({
      compact: (input) =>
        Effect.sync(() => {
          compactions.push(input)
          return { outcome: 'completed' } as const
        }),
    })

    await t.app.command(compactionItem('msg_c'))
    await t.waitFor(() => t.types().includes('session-execution-settled'))
    await t.outboxSettled()

    expect(compactions).toEqual([
      { sessionID: 'ses_1', reason: 'manual', inputID: 'msg_c' },
    ])
    expect(t.types()).toEqual([
      'session-inbox-enqueued',
      'session-execution-started',
      'session-inbox-delivered',
      'session-execution-settled',
    ])
    expect(t.log.inspect().at(-1)?.payload).toMatchObject({
      outcome: 'succeeded',
    })
  })

  it('compacts before a step when the host asks, then runs the step', async () => {
    const compactions: unknown[] = []
    const t = await start({
      compactFirst: 1,
      compact: (input) =>
        Effect.sync(() => {
          compactions.push(input)
          return { outcome: 'completed' } as const
        }),
    })
    t.model.script('ses_1', [{ finish: 'stop', text: 'after' }])

    await t.app.command(enqueue('msg_a'))
    await t.waitFor(() => t.types().includes('session-execution-settled'))
    await t.outboxSettled()

    expect(compactions).toEqual([{ sessionID: 'ses_1', reason: 'auto' }])
    expect(t.types()).toEqual([
      'session-inbox-enqueued',
      'session-execution-started',
      'session-inbox-delivered',
      'session-step-started',
      'session-block-recorded',
      'session-step-settled',
      'session-execution-settled',
    ])
  })

  it('moves the Session when a move item is delivered, without running a step', async () => {
    const released: string[] = []
    const t = await start({
      moving: (sessionID) =>
        Effect.sync(() => {
          released.push(sessionID)
        }),
    })

    await t.app.command({
      type: 'enqueueInput',
      payload: {
        sessionID: 'ses_1',
        inboxID: 'msg_m',
        type: 'move',
        payload: { location: { directory: '/tmp/other' }, projectID: 'prj_2' },
      },
    })
    await t.waitFor(() => t.types().includes('session-execution-settled'))
    await t.outboxSettled()

    expect(released).toEqual(['ses_1'])
    expect(t.types()).toEqual([
      'session-inbox-enqueued',
      'session-execution-started',
      'session-inbox-delivered',
      'session-moved',
      'session-execution-settled',
    ])
  })

  it("goes on after a manual compaction fails: the failure is the item's own", async () => {
    const error = { type: 'compaction.failed', message: 'no summary' }
    const t = await start({
      compact: () => Effect.succeed({ outcome: 'failed', error } as const),
    })
    t.model.script('ses_1', [{ finish: 'stop', text: 'Still here' }])

    await t.app.command(compactionItem('msg_c'))
    await t.app.command(enqueue('msg_a', 'queue'))
    await t.waitFor(() => t.types().includes('session-execution-settled'))
    await t.outboxSettled()

    // The queued input behind the compaction still runs.
    expect(
      t.types().filter((type) => type === 'session-step-settled'),
    ).toHaveLength(1)
    expect(t.log.inspect().at(-1)?.payload).toMatchObject({
      outcome: 'succeeded',
    })
  })

  it('lets the host settle what a dead attempt left open before the runtime settles the rest', async () => {
    let died = false
    let app: Awaited<ReturnType<typeof boot>>['app'] | undefined
    const recovered: string[] = []
    const t = await start({
      backoffMs: () => 0,
      // The first attempt opens two calls and dies without settling them.
      begin: (input, begin) =>
        died
          ? begin(input)
          : Effect.succeed({
              agent: 'build',
              model: { id: 'scripted', providerID: 'test' },
              run: (record) =>
                Effect.gen(function* () {
                  died = true
                  for (const id of ['call_child', 'call_other'])
                    yield* record.toolRequested({
                      id,
                      name: 'execute',
                      input: {},
                    })
                  return yield* Effect.die(new Error('process died'))
                }),
            }),
      // The host knows more about one of them.
      recover: (sessionID) =>
        Effect.promise(async () => {
          recovered.push(sessionID)
          const step = t.log
            .inspect()
            .find((event) => event.type === 'session-step-started')
          await app?.command({
            type: 'settleToolCall',
            payload: {
              sessionID,
              assistantMessageID: (
                step?.payload as { assistantMessageID: string }
              ).assistantMessageID,
              id: 'call_child',
              executed: false,
              error: {
                type: 'aborted',
                message: 'Tool execution interrupted: execute (child)',
              },
            },
          })
        }),
    })
    app = t.app
    t.model.script('ses_1', [{ finish: 'stop', text: 'done' }])

    await t.app.command(enqueue('msg_a'))
    await t.waitFor(() => t.types().includes('session-execution-settled'))
    await t.outboxSettled()

    expect(recovered).toEqual(['ses_1'])
    expect(
      t.log
        .inspect()
        .filter((event) => event.type === 'session-tool-settled')
        .map((event) => event.payload),
    ).toEqual([
      expect.objectContaining({
        id: 'call_child',
        error: expect.objectContaining({
          message: 'Tool execution interrupted: execute (child)',
        }),
      }),
      expect.objectContaining({
        id: 'call_other',
        error: expect.objectContaining({
          message: 'Tool execution interrupted: execute',
        }),
      }),
    ])
    expect(t.log.inspect().at(-1)?.payload).toMatchObject({
      outcome: 'succeeded',
    })
  })

  describe('a Session an external agent runs', () => {
    const vendor = {
      type: 'recordSessionFacts' as const,
      payload: {
        facts: [
          {
            type: 'session-model-selected',
            payload: {
              sessionID: 'ses_1',
              model: { id: 'sonnet', providerID: 'claude' },
            },
          },
        ] as const,
      },
    }

    it('wakes, and the host drives the execution whole', async () => {
      const driven: unknown[] = []
      const t = await start({
        drive: (input) =>
          Effect.sync(() => {
            driven.push(input)
            return { outcome: 'succeeded' } as const
          }),
      })
      await t.app.command(vendor)
      await t.app.command(enqueue('msg_a'))
      await t.waitFor(() => t.types().includes('session-execution-settled'))
      await t.outboxSettled()

      expect(driven).toEqual([{ sessionID: 'ses_1', continues: false }])
      // No step of the runtime's: the agent's steps are the host's facts.
      expect(t.types()).toEqual([
        'session-model-selected',
        'session-inbox-enqueued',
        'session-execution-started',
        'session-execution-settled',
      ])
      expect(t.log.inspect().at(-1)?.payload).toMatchObject({
        outcome: 'succeeded',
      })
    })

    it('fails the execution with the error the agent failed with', async () => {
      const error = { type: 'driver.unavailable', message: 'no CLI' }
      const t = await start({
        drive: () => Effect.succeed({ outcome: 'failed', error } as const),
      })
      await t.app.command(vendor)
      await t.app.command(enqueue('msg_a'))
      await t.waitFor(() => t.types().includes('session-execution-settled'))

      expect(t.log.inspect().at(-1)?.payload).toMatchObject({
        outcome: 'failed',
        error,
      })
    })

    it('fails the execution when the host runs no external agents', async () => {
      const t = await start()
      await t.app.command(vendor)
      await t.app.command(enqueue('msg_a'))
      await t.waitFor(() => t.types().includes('session-execution-settled'))

      expect(t.log.inspect().at(-1)?.payload).toMatchObject({
        outcome: 'failed',
        error: { type: 'driver.unavailable' },
      })
    })
  })

  it('fails the execution when a manual compaction breaks', async () => {
    const error = { type: 'compaction.failed', message: 'resolution died' }
    const t = await start({
      compact: () =>
        Effect.succeed({ outcome: 'failed', error, fatal: true } as const),
    })

    await t.app.command(compactionItem('msg_c'))
    await t.app.command(enqueue('msg_a', 'queue'))
    await t.waitFor(() => t.types().includes('session-execution-settled'))
    await t.outboxSettled()

    expect(t.types()).toEqual([
      'session-inbox-enqueued',
      'session-inbox-enqueued',
      'session-execution-started',
      'session-inbox-delivered', // the compaction
      'session-execution-settled',
    ])
    expect(t.log.inspect().at(-1)?.payload).toMatchObject({
      outcome: 'failed',
      error,
    })
    // The queued input behind it stays pending for the next wake.
    expect(
      await t.app.query({
        type: 'nextDeliverable',
        payload: { sessionID: 'ses_1', boundary: 'idle' },
      }),
    ).toMatchObject({ item: { inboxID: 'msg_a' } })
    expect(
      await t.app.query({
        type: 'executionStatus',
        payload: { sessionID: 'ses_1' },
      }),
    ).not.toHaveProperty('wakes')
  })

  it('delivers a steer enqueued mid-step at the next boundary, before the next step', async () => {
    const t = await start()
    const hold = gate()
    t.model.script('ses_1', [
      { finish: 'tool-calls', gate: hold.promise },
      { finish: 'stop' },
    ])

    await t.app.command(enqueue('msg_a'))
    await t.waitFor(() => t.types().includes('session-step-started'))
    await t.app.command(enqueue('msg_b', 'steer'))
    hold.open()
    await t.waitFor(() => t.types().includes('session-execution-settled'))
    await t.outboxSettled()

    expect(t.types()).toEqual([
      'session-inbox-enqueued',
      'session-execution-started',
      'session-inbox-delivered', // A, before step 1
      'session-step-started',
      'session-inbox-enqueued', // B arrives while step 1 is in flight
      'session-step-settled',
      'session-inbox-delivered', // B, at the boundary, before step 2
      'session-step-started',
      'session-step-settled',
      'session-execution-settled',
    ])
    const delivered = t.log
      .inspect()
      .filter((event) => event.type === 'session-inbox-delivered')
      .map((event) => (event.payload as { inboxID: string }).inboxID)
    expect(delivered).toEqual(['msg_a', 'msg_b'])
  })

  it('interrupt stops step events and keeps pending input pending', async () => {
    const t = await start()
    const hold = gate()
    t.model.script('ses_1', [
      { finish: 'tool-calls', gate: hold.promise },
      { finish: 'stop' },
    ])

    await t.app.command(enqueue('msg_a'))
    await t.waitFor(() => t.types().includes('session-step-started'))
    await t.app.command(enqueue('msg_c', 'queue'))
    await t.app.command({
      type: 'interruptExecution',
      payload: { sessionID: 'ses_1' },
    })
    hold.open()
    await t.outboxSettled()
    // Give a (wrongly) resumed job time to emit something.
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(t.types()).toEqual([
      'session-inbox-enqueued',
      'session-execution-started',
      'session-inbox-delivered',
      'session-step-started',
      'session-inbox-enqueued', // C
      'session-step-settled', // the interrupted step, aborted
      'session-execution-settled',
    ])
    expect(
      await t.app.query({
        type: 'executionStatus',
        payload: { sessionID: 'ses_1' },
      }),
    ).toEqual({
      status: 'settled',
      executions: 1,
      lastOutcome: 'interrupted',
      reason: 'user',
    })
    const pending = await t.app.query({
      type: 'nextDeliverable',
      payload: { sessionID: 'ses_1', boundary: 'idle' },
    })
    expect(pending.item).toMatchObject({ inboxID: 'msg_c' })
  })

  describe('physical attempts and retry', () => {
    const transport = { type: 'transport', message: 'connection reset' }
    const retryable = (text?: string) => ({
      finish: 'error' as const,
      retryable: true,
      error: transport,
      ...(text === undefined ? {} : { text }),
    })
    const payloads = (t: Awaited<ReturnType<typeof boot>>, type: string) =>
      t.log
        .inspect()
        .filter((event) => event.type === type)
        .map((event) => event.payload as Record<string, unknown>)

    it('retries a retryable failure as the same step and continues to stop', async () => {
      const t = await start()
      t.model.script('ses_1', [retryable(), { finish: 'stop', text: 'done' }])

      await t.app.command(enqueue('msg_a'))
      await t.waitFor(() => t.types().includes('session-execution-settled'))
      await t.outboxSettled()

      expect(t.types()).toEqual([
        'session-inbox-enqueued',
        'session-execution-started',
        'session-inbox-delivered',
        'session-step-started',
        'session-step-settled',
        'session-step-started',
        'session-block-recorded',
        'session-step-settled',
        'session-execution-settled',
      ])
      const retries = payloads(t, 'session-step-settled').filter(
        (settled) => settled.retry !== undefined,
      )
      expect(retries).toHaveLength(1)
      expect(retries[0]).toMatchObject({
        outcome: 'failed',
        error: transport,
        retry: { attempt: 1 },
      })
      const starts = payloads(t, 'session-step-started')
      expect(starts).toHaveLength(2)
      expect(starts[1]?.assistantMessageID).toBe(starts[0]?.assistantMessageID)
      expect(retries[0]?.assistantMessageID).toBe(starts[0]?.assistantMessageID)
      expect(
        await t.app.query({
          type: 'stepStatus',
          payload: { sessionID: 'ses_1' },
        }),
      ).toEqual({
        active: false,
        stepInFlight: false,
        stepsStarted: 1,
        attempts: 2,
      })
    })

    it('fails the execution on a non-retryable failure, with no retry event', async () => {
      const t = await start()
      const error = { type: 'auth', message: 'bad key' }
      t.model.script('ses_1', [{ finish: 'error', retryable: false, error }])

      await t.app.command(enqueue('msg_a'))
      await t.waitFor(() => t.types().includes('session-execution-settled'))
      await t.outboxSettled()

      expect(t.types()).toEqual([
        'session-inbox-enqueued',
        'session-execution-started',
        'session-inbox-delivered',
        'session-step-started',
        'session-step-settled',
        'session-execution-settled',
      ])
      expect(payloads(t, 'session-execution-settled')[0]).toMatchObject({
        outcome: 'failed',
        error,
      })
      expect(
        await t.app.query({
          type: 'executionStatus',
          payload: { sessionID: 'ses_1' },
        }),
      ).toMatchObject({
        status: 'settled',
        executions: 1,
        lastOutcome: 'failed',
        error: { type: expect.any(String) },
      })
    })

    it('fails the execution once retryable failures exceed the limit', async () => {
      const t = await start()
      const limit = 3
      // The initial attempt plus <limit> retries all fail.
      t.model.script(
        'ses_1',
        Array.from({ length: limit + 1 }, () => retryable()),
      )

      await t.app.command(enqueue('msg_a'))
      await t.waitFor(() => t.types().includes('session-execution-settled'))
      await t.outboxSettled()

      const failures = payloads(t, 'session-step-settled')
      expect(
        failures.map(
          (failure) =>
            (failure.retry as { attempt: number } | undefined)?.attempt,
        ),
      ).toEqual([1, 2, 3, undefined])
      expect(payloads(t, 'session-step-started')).toHaveLength(limit + 1)
      expect(failures.map((failure) => failure.outcome)).toEqual(
        Array.from({ length: limit + 1 }, () => 'failed'),
      )
      expect(t.types().at(-1)).toBe('session-execution-settled')
      expect(payloads(t, 'session-execution-settled')[0]).toMatchObject({
        outcome: 'failed',
        error: transport,
      })
    })
  })
})
