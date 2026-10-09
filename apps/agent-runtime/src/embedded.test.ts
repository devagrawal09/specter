import { EventLog } from '@specter-ts/core'
import { createMemoryEventLog } from '@specter-ts/memory'
import { Effect, Layer, PubSub, type Scope } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  type EmbeddedSessionRuntimeOptions,
  makeEmbeddedSessionRuntime,
} from './embedded.ts'
import { type Delta, DeltaChannel } from './plugins/delta-channel.ts'
import { Model } from './plugins/model.ts'
import { makeScriptedModel } from './plugins/scripted-model.ts'
import { modelStepHostLayer } from './plugins/step-host.ts'
import { makeSnapshotSliceStores, type SliceSnapshot } from './snapshots.ts'

const hostLog = () => {
  let next = 0
  return createMemoryEventLog({
    eventId: () => `evt_${String(++next).padStart(4, '0')}`,
  })
}

// The runtime as a host embeds it: over the host's Event Log, with the
// assistant message IDs and step I/O the host supplies.
const bootOver = (
  log: ReturnType<typeof hostLog>,
  options: EmbeddedSessionRuntimeOptions = {},
) =>
  Effect.gen(function* () {
    const model = makeScriptedModel()
    const runtime = yield* makeEmbeddedSessionRuntime({
      ...options,
      step: {
        assistantMessageID: ({ sessionID, ordinal }) =>
          `msg_boot_${sessionID}_${ordinal}`,
      },
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(EventLog, log),
          modelStepHostLayer({ agent: () => Effect.succeed('plan') }).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(Model, model),
                Layer.effect(
                  DeltaChannel,
                  Effect.map(PubSub.unbounded<Delta>(), (pubsub) => ({
                    pubsub,
                  })),
                ),
              ),
            ),
          ),
        ),
      ),
    )
    return { runtime, model, recorded: () => log.inspect() }
  })
const boot = Effect.suspend(() => bootOver(hostLog()))

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

  it('catches every Slice up at boot to the state a fold of the log gives', () =>
    run(
      Effect.gen(function* () {
        const log = hostLog()
        const bySlice = (snapshots: readonly SliceSnapshot[]) =>
          Object.fromEntries(
            snapshots.map((snapshot) => [
              snapshot.slice,
              { cursor: snapshot.cursor, state: snapshot.state },
            ]),
          )
        // A Session runs to the end of its execution, and the host saves the
        // runtime's Slices.
        const first = makeSnapshotSliceStores([])
        const saved = yield* Effect.scoped(
          Effect.gen(function* () {
            const { runtime, model, recorded } = yield* bootOver(log, {
              catchUp: true,
              stores: { slices: first.provide },
            })
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
            return first.snapshot()
          }),
        )
        const length = log.inspect().length

        // The next boot starts from them; another starts from the log alone.
        const resumed = makeSnapshotSliceStores(saved)
        yield* Effect.scoped(
          bootOver(log, { catchUp: true, stores: { slices: resumed.provide } }),
        )
        const fromLog = makeSnapshotSliceStores([])
        yield* Effect.scoped(
          bootOver(log, { catchUp: true, stores: { slices: fromLog.provide } }),
        )

        // Neither boot recorded anything, and both hold every Slice as the log
        // folds it.
        expect(log.inspect()).toHaveLength(length)
        const folded = bySlice(fromLog.snapshot())
        expect(Object.keys(folded).length).toBeGreaterThan(20)
        expect({ ...bySlice(saved), ...bySlice(resumed.snapshot()) }).toEqual(
          folded,
        )
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
