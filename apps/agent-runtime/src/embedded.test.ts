import { EventLog } from '@specter-ts/core'
import { createMemoryEventLog } from '@specter-ts/memory'
import { Effect, Layer, PubSub, type Scope } from 'effect'
import { describe, expect, it } from 'vitest'

import { makeEmbeddedSessionRuntime } from './embedded.ts'
import { type Delta, DeltaChannel } from './plugins/delta-channel.ts'
import { Model } from './plugins/model.ts'
import { makeScriptedModel } from './plugins/scripted-model.ts'

// The runtime as a host embeds it: over the host's Event Log, with the
// assistant message IDs and agent the host supplies.
const boot = Effect.gen(function* () {
  let next = 0
  const log = createMemoryEventLog({
    eventId: () => `evt_${String(++next).padStart(4, '0')}`,
  })
  const model = makeScriptedModel()
  const runtime = yield* makeEmbeddedSessionRuntime({
    step: {
      assistantMessageID: ({ sessionID, ordinal }) =>
        `msg_boot_${sessionID}_${ordinal}`,
      agent: () => Effect.succeed('plan'),
    },
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(EventLog, log),
        Layer.succeed(Model, model),
        Layer.effect(
          DeltaChannel,
          Effect.map(PubSub.unbounded<Delta>(), (pubsub) => ({ pubsub })),
        ),
      ),
    ),
  )
  return { runtime, model, recorded: () => log.inspect() }
})

const waitFor = (condition: () => boolean) =>
  Effect.gen(function* () {
    for (let tries = 0; tries < 400 && !condition(); tries++)
      yield* Effect.sleep('5 millis')
    if (!condition()) return yield* Effect.die(new Error('Timed out'))
  })

const run = <A>(program: Effect.Effect<A, unknown, Scope.Scope>) =>
  Effect.runPromise(Effect.scoped(program))

const registration = {
  type: 'registerSession' as const,
  payload: {
    sessionID: 'ses_1',
    projectID: 'prj_1',
    location: { directory: '/tmp/ws' },
    slug: 'brave-otter',
    version: '2',
  },
}

describe('embedded runtime', () => {
  it('runs a session over the host Event Log', () =>
    run(
      Effect.gen(function* () {
        const { runtime, model, recorded } = yield* boot
        model.script('ses_1', [{ finish: 'stop', text: 'Hello' }])
        yield* runtime.command(registration)
        yield* runtime.command({
          type: 'enqueueInput',
          payload: {
            sessionID: 'ses_1',
            inboxID: 'msg_in_1',
            type: 'user',
            payload: { text: 'Hi' },
          },
        })
        yield* waitFor(() =>
          recorded().some(
            (event) => event.type === 'session-execution-settled',
          ),
        )

        expect(recorded().map((event) => event.type)).toEqual([
          'session-created',
          'session-inbox-enqueued',
          'session-execution-started',
          'session-inbox-delivered',
          'session-step-started',
          'session-block-recorded',
          'session-step-settled',
          'session-execution-settled',
        ])
        expect(recorded().map((event) => event.id)).toEqual(
          recorded().map(
            (_, index) => `evt_${String(index + 1).padStart(4, '0')}`,
          ),
        )
        expect(recorded().at(-1)?.payload).toEqual({
          sessionID: 'ses_1',
          outcome: 'succeeded',
        })
        const step = recorded().find(
          (event) => event.type === 'session-step-started',
        )
        expect(step?.payload).toMatchObject({
          assistantMessageID: 'msg_boot_ses_1_0',
          agent: 'plan',
        })
      }),
    ))

  it('refuses a second registration of the same Session', () =>
    run(
      Effect.gen(function* () {
        const { runtime } = yield* boot
        yield* runtime.command(registration)
        const second = yield* Effect.flip(runtime.command(registration))
        expect(String(second)).toContain('Session already registered')
      }),
    ))
})
