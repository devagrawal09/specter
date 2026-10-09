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
import { modelStepHostLayer } from './plugins/step-host.ts'
import { makeScriptedModel } from './plugins/scripted-model.ts'

// The real app, in process: memory Event Log, memory Slice stores, immediate
// Reaction scheduler, memory outbox store for the step Plugin, and the
// Model (scripted) + delta channel services the Plugin reads.
const boot = async (options: { readonly concurrency?: number } = {}) => {
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

  const full = createSessionAppConfig(
    outbox,
    options.concurrency === undefined
      ? {}
      : { worker: { concurrency: options.concurrency } },
  )
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
      modelStepHostLayer().pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(Model, model),
            Layer.succeed(DeltaChannel, { pubsub }),
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
      'session-execution-settled',
    ])
    expect(
      await t.app.query({
        type: 'executionStatus',
        payload: { sessionID: 'ses_1' },
      }),
    ).toEqual({ status: 'settled', executions: 1, lastOutcome: 'interrupted' })
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
      ).toEqual({ status: 'settled', executions: 1, lastOutcome: 'failed' })
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
