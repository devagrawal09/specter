import type { StandardSchemaV1 } from '@standard-schema/spec'
import { Context, Effect } from 'effect'

import type { SliceStoreService } from '../adapters'
import type { SpecterEffectError } from '../effect/runtime'
import {
  type CommandInputOf,
  type CommandReceipt,
  createCommandSlice,
  createEventDefinition,
  createQuerySlice,
  createReactionSlice,
  event,
  type QueryInputOf,
  type QueryOutputOf,
  type ReactionPlugin,
  type ReactionPluginRequirements,
} from './index'

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false
type Expect<TValue extends true> = TValue

function schema<TInput, TOutput>(
  transform: (input: TInput) => TOutput,
): StandardSchemaV1<TInput, TOutput> {
  return {
    '~standard': {
      version: 1,
      vendor: 'specter-core-type-test',
      validate: (value) => ({ value: transform(value as TInput) }),
    },
  }
}

type AmountState = { total: number }
class AmountStore extends Context.Service<
  AmountStore,
  SliceStoreService<Readonly<AmountState>, AmountState>
>()('type-test/AmountStore') {}

type QueryState = { amount: number }
class QueryStore extends Context.Service<
  QueryStore,
  SliceStoreService<Readonly<QueryState>, QueryState>
>()('type-test/QueryStore') {}

const commandStart = createCommandSlice('recordAmount')
// @ts-expect-error A description is required before scenarios.
commandStart.scenarios
const commandDescription = commandStart.description('Records an amount.')
// @ts-expect-error Scenarios are required before implementation details.
commandDescription.inputSchema
const commandSpec = commandDescription.scenarios({
  description: 'Records one amount.',
  given: [],
  when: { text: '41' },
  expect: [event('amount-recorded', { amount: 41 })],
})
// @ts-expect-error A specification cannot skip inputSchema.
commandSpec.store

const amountRecorded = createEventDefinition(
  'amount-recorded',
  schema<{ amount: number }, { amount: number }>((payload) => payload),
)
const commandStoreStep = commandSpec.inputSchema(
  schema<{ text: string }, { amount: number }>((input) => ({
    amount: Number(input.text),
  })),
)
// @ts-expect-error A store is required before apply or handle.
commandStoreStep.handle
// @ts-expect-error eager must be boolean.
commandStoreStep.store(AmountStore, { eager: 'yes' })
const commandApplyStep = commandStoreStep.store(AmountStore)
const commandImplementation = commandApplyStep
  .apply(amountRecorded, async (applied, state) => {
    type _EventType = Expect<Equal<typeof applied.type, 'amount-recorded'>>
    type _Payload = Expect<Equal<typeof applied.payload, { amount: number }>>
    type _State = Expect<Equal<typeof state, { total: number }>>
    const eventType: _EventType = true
    const payload: _Payload = true
    const stateType: _State = true
    void [eventType, payload, stateType, applied.id, applied.recordedAt]
    state.total += applied.payload.amount
  })
  .handle(async (command, state) => {
    type _Command = Expect<Equal<typeof command, { amount: number }>>
    type _ReadState = Expect<Equal<typeof state, Readonly<{ total: number }>>>
    const commandType: _Command = true
    const stateType: _ReadState = true
    void [commandType, stateType, state]
    return [amountRecorded.create(command)]
  })

export type CommandStageCheck = Expect<
  Equal<typeof commandImplementation.stage, 'implementation'>
>
export type CommandPublicInputCheck = Expect<
  Equal<CommandInputOf<typeof commandImplementation>, { text: string }>
>

const querySpec = createQuerySlice('readAmount')
  .description('Reads an amount.')
  .scenarios({
    description: 'Returns the selected amount.',
    given: [event('amount-recorded', { amount: 41 })],
    when: { id: '41' },
    expect: { label: 'Amount: 41' },
  })
const queryOutputStep = querySpec.inputSchema(
  schema<{ id: string }, { id: number }>((input) => ({ id: Number(input.id) })),
)
// @ts-expect-error A query output schema is required before its store.
queryOutputStep.store
const queryImplementation = queryOutputStep
  .outputSchema(
    schema<{ amount: number }, { label: string }>((result) => ({
      label: `Amount: ${result.amount}`,
    })),
  )
  .store(QueryStore)
  .apply(amountRecorded, async (applied, state) => {
    state.amount = applied.payload.amount
  })
  .handle(async (query, state) => {
    type _Query = Expect<Equal<typeof query, { id: number }>>
    const queryType: _Query = true
    void queryType
    return { amount: query.id === 41 ? state.amount : 0 }
  })

export type QueryInputTransformCheck = Expect<
  Equal<Parameters<typeof queryImplementation.handle>[0], { id: number }>
>
export type QueryResultBeforeDecodeCheck = Expect<
  Equal<
    Awaited<ReturnType<typeof queryImplementation.handle>>,
    { amount: number }
  >
>
export type QueryPublicInputCheck = Expect<
  Equal<QueryInputOf<typeof queryImplementation>, { id: string }>
>
export type QueryPublicOutputCheck = Expect<
  Equal<QueryOutputOf<typeof queryImplementation>, { label: string }>
>

const defaultCommandReaction = createReactionSlice('repeatAmount')
  .description('Dispatches one same-app Command.')
  .scenarios({
    description: 'Repeats one amount.',
    given: [event('amount-recorded', { amount: 41 })],
    expect: [{ type: 'recordAmount', payload: { text: '41' } }],
  })
  .outputSchema<{
    type: 'recordAmount'
    payload: { text: string }
  }>()
  .store(QueryStore)
  .apply(amountRecorded, async (applied, state) => {
    state.amount = applied.payload.amount
  })
  .handle(async (state) => ({
    type: 'recordAmount',
    payload: { text: String(state.amount) },
  }))

export type DefaultReactionPluginCheck = Expect<
  Equal<
    typeof defaultCommandReaction.plugin,
    | ReactionPlugin<{
        type: 'recordAmount'
        payload: { text: string }
      }>
    | undefined
  >
>

const externalReactionStep = createReactionSlice('notifyAmount')
  .description('Produces one external effect.')
  .scenarios({
    description: 'Produces one notification.',
    given: [event('amount-recorded', { amount: 41 })],
    expect: ['Amount: 41'],
  })
  .outputSchema<string>()

// @ts-expect-error Non-Command output requires an explicit Plugin.
externalReactionStep.store

class AmountNotifier extends Context.Service<
  AmountNotifier,
  { notify(label: string): Effect.Effect<void> }
>()('type-test/AmountNotifier') {}

const notifyingReaction = externalReactionStep
  .plugin(({ command, query }) =>
    Effect.gen(function* () {
      const notifier = yield* AmountNotifier
      yield* Effect.addFinalizer(() => Effect.void)
      return (output, context) =>
        Effect.gen(function* () {
          const read = query(queryImplementation, { id: '41' })
          type _Read = Expect<
            Equal<
              typeof read,
              Effect.Effect<{ label: string }, SpecterEffectError>
            >
          >
          const readType: _Read = true
          void readType
          // @ts-expect-error Query input is typed by the Query Slice.
          query(queryImplementation, { id: 41 })
          const receipt = yield* command(
            { type: 'recordAmount', payload: { text: output } },
            { idempotencyKey: context.deliveryId },
          )
          type _Receipt = Expect<Equal<typeof receipt, CommandReceipt>>
          const receiptType: _Receipt = true
          void receiptType
          if (!receipt.duplicate) yield* notifier.notify(output)
        })
    }),
  )
  .store(QueryStore)
  .handle(async (state) => `Amount: ${state.amount}`)

export type PluginRequirementCheck = Expect<
  Equal<ReactionPluginRequirements<typeof notifyingReaction>, AmountNotifier>
>
export type DefaultPluginRequirementCheck = Expect<
  Equal<ReactionPluginRequirements<typeof defaultCommandReaction>, never>
>
export type NonReactionPluginRequirementCheck = Expect<
  Equal<ReactionPluginRequirements<typeof queryImplementation>, never>
>

export type ErasedPluginRequirementCheck = Expect<
  Equal<
    ReactionPluginRequirements<{
      readonly kind: 'reaction'
      readonly plugin?: ReactionPlugin<string, unknown>
    }>,
    never
  >
>

export const undeclaredRequirementPlugin: ReactionPlugin<string> = () =>
  // @ts-expect-error An annotated Plugin must declare the services it reads.
  Effect.gen(function* () {
    const notifier = yield* AmountNotifier
    return (output: string) => notifier.notify(output)
  })

export const declaredRequirementPlugin: ReactionPlugin<
  string,
  AmountNotifier
> = () =>
  Effect.gen(function* () {
    const notifier = yield* AmountNotifier
    return (output: string) => notifier.notify(output)
  })
