import type {
  CommandSlice,
  QuerySlice,
  ReactionSlice,
  SpecterApp,
  SpecterAppConfig,
  SpecterAppConfigOf,
  SpecterCommandEnvelope,
  SpecterQueryEnvelope,
} from '..'
import * as core from '..'

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false
type Expect<TValue extends true> = TValue

declare const addTodo: CommandSlice<'addTodo', { title: string }>
declare const todoCount: QuerySlice<
  'todoCount',
  { completed: boolean },
  { completed: boolean },
  number,
  { count: number }
>
declare const notifyTodo: ReactionSlice<'notifyTodo', string>

type Config = Omit<SpecterAppConfig, 'slices'> & {
  readonly slices: {
    readonly addTodo: typeof addTodo
    readonly todoCount: typeof todoCount
    readonly notifyTodo: typeof notifyTodo
  }
}

declare const app: SpecterApp<Config>

const execution = app.command({
  type: 'addTodo',
  payload: { title: 'Ship it' },
})
const query = app.query({
  type: 'todoCount',
  payload: { completed: false },
})
const subscription = app.subscribe({
  type: 'todoCount',
  payload: { completed: true },
})

// @ts-expect-error Command payloads are correlated with their type.
app.command({ type: 'addTodo', payload: { completed: false } })
// @ts-expect-error Query payloads are correlated with their type.
app.query({ type: 'todoCount', payload: { title: 'wrong' } })
// @ts-expect-error Reaction names are not remotely dispatchable Queries.
app.query({ type: 'notifyTodo', payload: undefined })

// @ts-expect-error Specification builders are available only from @specter-ts/spec.
core.createCommandSlice
// @ts-expect-error Scenario event helpers are available only from @specter-ts/spec.
core.event
// @ts-expect-error Core no longer owns a browser/client transport.
core.defineSpecterClient

export type CommandEnvelopeCheck = Expect<
  Equal<
    SpecterCommandEnvelope<Config>,
    { readonly type: 'addTodo'; readonly payload: { title: string } }
  >
>
export type QueryEnvelopeCheck = Expect<
  Equal<
    SpecterQueryEnvelope<Config>,
    {
      readonly type: 'todoCount'
      readonly payload: { completed: boolean }
    }
  >
>
export type ConfigExtractionCheck = Expect<
  Equal<SpecterAppConfigOf<typeof app>, Config>
>
export type CommandExecutionCheck = Expect<
  Equal<
    Awaited<typeof execution>,
    {
      readonly events: readonly import('../definition').PersistedEvent[]
      readonly version: number
      readonly duplicate: boolean
      readonly reactions: Promise<void>
    }
  >
>
export type QueryResultCheck = Expect<
  Equal<Awaited<typeof query>, { count: number }>
>
export type SubscriptionResultCheck = Expect<
  Equal<
    Awaited<
      ReturnType<
        ReturnType<(typeof subscription)[typeof Symbol.asyncIterator]>['next']
      >
    >,
    IteratorResult<{ count: number }>
  >
>
