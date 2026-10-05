import { Context, Effect, Layer } from 'effect'

import {
  createSpecterApp,
  EventLog,
  implementCommand,
  implementReaction,
  type PreparedSpecterApp,
  prepareSpecterApp,
  type ReactionPlugin,
  type SliceStoreService,
} from '..'
import {
  createCommandSlice,
  createReactionSlice,
  event,
} from '@specter-ts/spec'
import { createSpecterAppLayer, prepareSpecterRuntime } from './runtime'

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

class ValueNotifier extends Context.Service<
  ValueNotifier,
  { notify(value: number): Effect.Effect<void> }
>()('specter-type-test/ValueNotifier') {}

const notifyValue = implementReaction(
  JSON.stringify(
    createReactionSlice('notifyValue')
      .description('Notifies a recorded value.')
      .scenarios({
        description: 'Notifies one value.',
        given: [event('value-recorded', 1)],
        expect: [1],
      }),
  ),
)
  .outputSchema<number>()
  .plugin(() =>
    Effect.gen(function* () {
      const notifier = yield* ValueNotifier
      return (value) => notifier.notify(value)
    }),
  )
  .store(RuntimeTypeStore)
  .handle(async (state) => state.value)

const pluginConfig = {
  events: [],
  slices: { command, notifyValue },
} as const
const pluginRuntimeLayer = createSpecterAppLayer(pluginConfig)

export type PluginRuntimeRequirements = Expect<
  Equal<
    Layer.Services<typeof pluginRuntimeLayer>,
    RuntimeTypeStore | ValueNotifier | EventLog
  >
>

declare const notifierService: ValueNotifier['Service']
const storeAndEventLog = Layer.mergeAll(
  Layer.succeed(RuntimeTypeStore, storeService),
  Layer.succeed(EventLog, eventLogService),
)

// @ts-expect-error The app Layer must provide every Plugin service.
void createSpecterApp(pluginConfig, storeAndEventLog)
void createSpecterApp(
  pluginConfig,
  Layer.mergeAll(
    storeAndEventLog,
    Layer.succeed(ValueNotifier, notifierService),
  ),
)

declare const erasedPlugin: ReactionPlugin<number, unknown>
const erasedNotifyValue = implementReaction(
  JSON.stringify(
    createReactionSlice('notifyValue')
      .description('Notifies a recorded value.')
      .scenarios({
        description: 'Notifies one value.',
        given: [event('value-recorded', 1)],
        expect: [1],
      }),
  ),
)
  .outputSchema<number>()
  .plugin(erasedPlugin)
  .store(RuntimeTypeStore)
  .handle(async (state) => state.value)

// An erased `unknown` Plugin requirement cannot name a service; it must not
// make every dependency Layer unacceptable.
void createSpecterApp(
  { events: [], slices: { command, notifyValue: erasedNotifyValue } } as const,
  storeAndEventLog,
)

const preparedLayer = Layer.unwrap(
  prepareSpecterRuntime({ events: [], slices: { command } } as const).pipe(
    Effect.map((prepared) => createSpecterAppLayer(prepared)),
  ),
)

export type PreparedRuntimeRequirements = Expect<
  Equal<Layer.Services<typeof preparedLayer>, RuntimeTypeStore | EventLog>
>

// Preparing a config must keep its Plugin requirements.
const preparedPluginConfig = prepareSpecterApp(pluginConfig)

export type PreparedPluginConfig = Expect<
  Equal<
    Awaited<typeof preparedPluginConfig>,
    PreparedSpecterApp<typeof pluginConfig>
  >
>

const preparedPluginLayer = Layer.unwrap(
  prepareSpecterRuntime(pluginConfig).pipe(
    Effect.map((prepared) => createSpecterAppLayer(prepared)),
  ),
)

export type PreparedPluginRuntimeRequirements = Expect<
  Equal<
    Layer.Services<typeof preparedPluginLayer>,
    RuntimeTypeStore | ValueNotifier | EventLog
  >
>

declare const preparedPlugin: PreparedSpecterApp<typeof pluginConfig>

// @ts-expect-error A prepared config still needs every Plugin service.
void createSpecterApp(preparedPlugin, storeAndEventLog)
void createSpecterApp(
  preparedPlugin,
  Layer.mergeAll(
    storeAndEventLog,
    Layer.succeed(ValueNotifier, notifierService),
  ),
)
