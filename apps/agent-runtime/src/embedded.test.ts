import type { PersistedEvent } from '@specter-ts/core'
import { Effect, Layer, PubSub, type Scope } from 'effect'
import { describe, expect, it } from 'vitest'

import { makeEmbeddedSessionRuntime } from './embedded.ts'
import { type Delta, DeltaChannel } from './plugins/delta-channel.ts'
import { Model } from './plugins/model.ts'
import { makeScriptedModel } from './plugins/scripted-model.ts'

// The runtime as a host embeds it: the host sees every commit in log order,
// with the event IDs and assistant message IDs it supplied.
const boot = Effect.gen(function* () {
  const committed: PersistedEvent[] = []
  let next = 0
  const model = makeScriptedModel()
  const runtime = yield* makeEmbeddedSessionRuntime({
    onCommit: (events) => Effect.sync(() => committed.push(...events)),
    eventId: () => `evt_${String(++next).padStart(4, '0')}`,
    step: {
      assistantMessageID: ({ sessionID, ordinal }) =>
        `msg_boot_${sessionID}_${ordinal}`,
      agent: () => Effect.succeed('plan'),
    },
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(Model, model),
        Layer.effect(
          DeltaChannel,
          Effect.map(PubSub.unbounded<Delta>(), (pubsub) => ({ pubsub })),
        ),
      ),
    ),
  )
  return { runtime, model, committed }
})

const waitFor = (condition: () => boolean) =>
  Effect.gen(function* () {
    for (let tries = 0; tries < 400 && !condition(); tries++)
      yield* Effect.sleep('5 millis')
    if (!condition()) return yield* Effect.die(new Error('Timed out'))
  })

const run = <A>(program: Effect.Effect<A, unknown, Scope.Scope>) =>
  Effect.runPromise(Effect.scoped(program))

describe('embedded runtime', () => {
  it('hands the host every commit of a session run, in order', () =>
    run(
      Effect.gen(function* () {
        const { runtime, model, committed } = yield* boot
        model.script('ses_1', [{ finish: 'stop', text: 'Hello' }])
        yield* runtime.command({
          type: 'registerSession',
          payload: {
            sessionID: 'ses_1',
            projectID: 'prj_1',
            location: { directory: '/tmp/ws' },
            slug: 'brave-otter',
            version: '2',
          },
        })
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
          committed.some(
            (event) => event.type === 'session-execution-succeeded',
          ),
        )

        expect(committed.map((event) => event.type)).toEqual([
          'session-created',
          'session-inbox-enqueued',
          'session-execution-started',
          'session-inbox-delivered',
          'session-step-started',
          'session-text-started',
          'session-text-ended',
          'session-step-ended',
          'session-execution-succeeded',
        ])
        expect(committed.map((event) => event.id)).toEqual(
          committed.map(
            (_, index) => `evt_${String(index + 1).padStart(4, '0')}`,
          ),
        )
        expect(committed.map((event) => event.order)).toEqual(
          committed.map((_, index) => index + 1),
        )
        const step = committed.find(
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
        yield* runtime.command(registration)
        const second = yield* Effect.flip(runtime.command(registration))
        expect(String(second)).toContain('Session already registered')
      }),
    ))
})
