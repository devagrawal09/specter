import type { StandardSchemaV1 } from '@standard-schema/spec'
import { Context, Effect, Layer, ManagedRuntime } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import type { EventLogAdapter, ReactionScheduler, SliceStoreAdapter } from '..'
import { createEventDefinition } from '..'
import { createCommandSlice, event } from '../spec-entry'
import { createSpecterAppLayer, SpecterRuntime } from './runtime'
import { createSpecterEffectAdapters } from './adapters'

const numberSchema: StandardSchemaV1<number> = {
  '~standard': {
    version: 1,
    vendor: 'specter-effect-test',
    validate: (value) => ({ value: value as number }),
  },
}

describe('Effect-native runtime', () => {
  it('shares one ManagedRuntime boundary across Slice adapters', async () => {
    const Prefix = Context.GenericTag<{ readonly value: string }>('Prefix')
    const runtime = ManagedRuntime.make(
      Layer.succeed(Prefix, { value: 'effect:' }),
    )
    const adapters = createSpecterEffectAdapters(runtime.runPromise)
    const handle = adapters.adapt((value: string) =>
      Effect.map(Prefix, (prefix) => `${prefix.value}${value}`),
    )
    const plugin = adapters.reactionPlugin<string, never>(() =>
      Effect.map(
        Prefix,
        (prefix) => (output: string) =>
          Effect.succeed(`${prefix.value}${output}`),
      ),
    )

    await expect(handle('handler')).resolves.toBe('effect:handler')
    const execute = await plugin(async () => undefined)
    await expect(
      execute('reaction', {
        deliveryId: 'delivery-1',
        scheduledAt: new Date(0).toISOString(),
        attemptId: 'attempt-1',
        attemptNumber: 1,
      }),
    ).resolves.toBe('effect:reaction')
    await runtime.dispose()
  })

  it('provides operations through Context and closes with Scope', async () => {
    const recorded = createEventDefinition('value-recorded', numberSchema)
    const command = createCommandSlice('recordValue')
      .description('Records one value.')
      .scenarios({
        description: 'Records one value.',
        given: [],
        when: 3,
        expect: [event('value-recorded', 3)],
      })
      .inputSchema<number>()
      .store(memoryStore())
      .handle(async (value) => [recorded.create(value)])
    const dispose = vi.fn(async () => undefined)
    const layer = createSpecterAppLayer(
      Effect.succeed({
        events: [recorded],
        eventLog: memoryEventLog(),
        schedule: immediateScheduler,
        slices: [command],
        dispose,
      } as const),
    )
    const program = Effect.gen(function* () {
      const app = yield* SpecterRuntime
      return yield* app.command({ type: 'recordValue', payload: 3 })
    })

    const execution = await Effect.runPromise(
      Effect.scoped(Effect.provide(program, layer)),
    )

    expect(execution).toMatchObject({ version: 1, duplicate: false })
    expect(dispose).toHaveBeenCalledOnce()
  })
})

const immediateScheduler: ReactionScheduler = (run) => () => {
  const completion = run({
    deliveryId: 'effect-test-pass',
    scheduledAt: new Date(0).toISOString(),
    attemptId: 'effect-test-pass:attempt:1',
    attemptNumber: 1,
  })
  return () => completion
}

function memoryStore(): SliceStoreAdapter<Record<string, never>> {
  const state = {}
  return {
    get: async () => ({
      write: state,
      read: state,
      lastAppliedOrder: async () => 0,
      setLastAppliedOrder: async () => undefined,
    }),
    transaction: async (_sliceName, run) =>
      run({
        write: state,
        read: state,
        lastAppliedOrder: async () => 0,
        setLastAppliedOrder: async () => undefined,
      }),
  }
}

function memoryEventLog(): EventLogAdapter {
  let version = 0
  const adapter: EventLogAdapter = {
    query: async () => [],
    currentVersion: async () => version,
    findCommit: async () => undefined,
    append: async (events, options = {}) => {
      const persisted = events.map((draft) => ({
        ...draft,
        id: `event-${++version}`,
        order: version,
        recordedAt: new Date(0).toISOString(),
      }))
      return {
        events: persisted,
        version,
        duplicate: false,
        idempotencyKey: options.idempotencyKey,
        fingerprint: options.fingerprint,
      }
    },
    transaction: (run) => run(adapter),
  }
  return adapter
}
