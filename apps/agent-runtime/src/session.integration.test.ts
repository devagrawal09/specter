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
import { makeScriptedModel, ScriptedModel } from './plugins/scripted-model.ts'

// The real app, in process: memory Event Log, memory Slice stores, immediate
// Reaction scheduler, memory outbox store for the step Plugin, and the
// ScriptedModel + delta channel services the Plugin reads.
const boot = async () => {
  const log = createMemoryEventLog()
  await Effect.runPromise(
    log.append([
      sessionEvent('session-created').create({
        sessionID: SessionID.make('ses_1'),
        projectID: ProjectID.make('prj_1'),
        location: { directory: AbsolutePath.make('/tmp/ws') },
        slug: 'brave-otter',
        version: '2',
      }),
    ]),
  )
  const model = makeScriptedModel()
  const pubsub = Effect.runSync(PubSub.unbounded<Delta>())
  const scope = Effect.runSync(Scope.make())
  const subscription = Effect.runSync(
    Scope.provide(PubSub.subscribe(pubsub), scope),
  )
  const outbox =
    createMemoryReactionOutboxStore<OutboxedReaction<RunStepRequest>>()

  const full = createSessionAppConfig(outbox)
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
      Layer.succeed(ScriptedModel, model),
      Layer.succeed(DeltaChannel, { pubsub }),
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
        throw new Error(`Timed out; events: ${types().join(', ')}`)
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

const enqueue = (inboxID: string, delivery?: 'steer' | 'queue') => ({
  type: 'enqueueInput' as const,
  payload: {
    sessionID: 'ses_1',
    inboxID,
    type: 'user' as const,
    payload: { text: `prompt ${inboxID}` },
    ...(delivery ? { delivery } : {}),
  },
})

let running: Awaited<ReturnType<typeof boot>> | undefined
const start = async () => {
  running = await boot()
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
    await t.waitFor(() => t.types().includes('session-execution-succeeded'))
    const jobs = await t.outboxSettled()

    expect(t.types()).toEqual([
      'session-inbox-enqueued',
      'session-execution-started',
      'session-inbox-delivered',
      'session-step-started',
      'session-step-ended',
      'session-step-started',
      'session-step-ended',
      'session-execution-succeeded',
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
    await t.waitFor(() => t.types().includes('session-execution-succeeded'))
    await t.outboxSettled()

    expect(t.types()).toEqual([
      'session-inbox-enqueued',
      'session-execution-started',
      'session-inbox-delivered', // A, before step 1
      'session-step-started',
      'session-inbox-enqueued', // B arrives while step 1 is in flight
      'session-step-ended',
      'session-inbox-delivered', // B, at the boundary, before step 2
      'session-step-started',
      'session-step-ended',
      'session-execution-succeeded',
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
      'session-execution-interrupted',
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
})
