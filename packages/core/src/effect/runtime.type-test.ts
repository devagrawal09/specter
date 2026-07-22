import { Context, Layer } from 'effect'

import { EventLog, implementCommand, type SliceStoreService } from '..'
import { createCommandSlice, event } from '@specter-ts/spec'
import { createSpecterAppLayer } from './runtime'

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false
type Expect<TValue extends true> = TValue

type State = { value: number }
class RuntimeTypeStore extends Context.Service<
  RuntimeTypeStore,
  SliceStoreService<Readonly<State>, State>
>()('specter-type-test/RuntimeTypeStore') {}

const command = implementCommand(
  JSON.stringify(
    createCommandSlice('recordValue')
      .description('Records a value.')
      .scenarios({
        description: 'Records a value.',
        given: [],
        when: 1,
        expect: [event('value-recorded', 1)],
      }),
  ),
)
  .inputSchema<number>()
  .store(RuntimeTypeStore)
  .handle(async () => [])

declare const storeService: RuntimeTypeStore['Service']
declare const eventLogService: EventLog['Service']

const runtimeLayer = createSpecterAppLayer({
  events: [],
  slices: { command },
} as const)

export type MissingRuntimeRequirements = Expect<
  Equal<Layer.Services<typeof runtimeLayer>, RuntimeTypeStore | EventLog>
>

const provided = runtimeLayer.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(RuntimeTypeStore, storeService),
      Layer.succeed(EventLog, eventLogService),
    ),
  ),
)

export type ProvidedRuntimeRequirement = Expect<
  Equal<Layer.Services<typeof provided>, never>
>
