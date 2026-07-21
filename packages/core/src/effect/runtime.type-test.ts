import { Context, Layer } from 'effect'

import type {
  EventLogAdapter,
  ReactionScheduler,
  SliceStoreService,
} from '..'
import { createCommandSlice, event } from '../spec-entry'
import { createSpecterAppLayer } from './runtime'

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() =>
    T extends TRight ? 1 : 2
    ? true
    : false
type Expect<TValue extends true> = TValue

type State = { value: number }
class RuntimeTypeStore extends Context.Service<
  RuntimeTypeStore,
  SliceStoreService<Readonly<State>, State>
>()('specter-type-test/RuntimeTypeStore') {}

const command = createCommandSlice('recordValue')
  .description('Records a value.')
  .scenarios({
    description: 'Records a value.',
    given: [],
    when: 1,
    expect: [event('value-recorded', 1)],
  })
  .inputSchema<number>()
  .store(RuntimeTypeStore)
  .handle(async () => [])

declare const eventLog: EventLogAdapter
declare const schedule: ReactionScheduler
declare const service: RuntimeTypeStore['Service']

const runtimeLayer = createSpecterAppLayer({
  events: [],
  eventLog,
  schedule,
  slices: [command],
} as const)

export type MissingStoreRequirement = Expect<
  Equal<Layer.Services<typeof runtimeLayer>, RuntimeTypeStore>
>

const provided = runtimeLayer.pipe(
  Layer.provide(Layer.succeed(RuntimeTypeStore, service)),
)

export type ProvidedStoreRequirement = Expect<
  Equal<Layer.Services<typeof provided>, never>
>
