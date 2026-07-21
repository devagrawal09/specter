import type { StandardSchemaV1 } from '@standard-schema/spec'

import type { ReactionDeliveryContext } from '../adapters/reaction-scheduler'
import type {
  SliceStoreService,
  SliceStoreTag,
} from '../adapters/slice-store'
import type { Event, EventDefinition, EventDraft } from './events'
import type {
  CommandScenario,
  NonEmptyScenarios,
  QueryScenario,
  ReactionScenario,
} from './scenario-types'

export type {
  EventLogAdapter,
  ReactionScheduler,
  SliceStoreError,
  SliceStoreRead,
  SliceStoreRequirement,
  SliceStoreService,
  SliceStoreTag,
  SliceStoreWrite,
} from '../adapters'

export type ApplyEventDefinition = {
  readonly type: string
  readonly schema: StandardSchemaV1
  readonly decode: (payload: unknown) => Promise<unknown>
}

export type EventForDefinition<TDefinition> =
  TDefinition extends EventDefinition<
    infer TType extends string,
    infer TPayload
  >
    ? Event<TType, TPayload>
    : TDefinition extends {
          readonly type: infer TType extends string
          readonly decode: (payload: unknown) => Promise<infer TPayload>
        }
      ? Event<TType, TPayload>
      : never

type ApplyHandler<TEvent extends Event, TState> = {
  bivarianceHack(event: TEvent, state: TState): Promise<void>
}['bivarianceHack']

export type ApplyRegistration<TState = unknown> = {
  readonly event: ApplyEventDefinition
  readonly handle: ApplyHandler<Event, TState>
}

export type RejectedCommand = {
  readonly reason: string
}

export type CommandEnvelope<
  TName extends string = string,
  TPayload = unknown,
> = {
  readonly type: TName
  readonly payload: TPayload
}

type SliceBase<
  TName extends string,
  TScenarios extends NonEmptyScenarios<
    CommandScenario | QueryScenario | ReactionScenario<unknown>
  >,
> = {
  readonly stage: 'implementation'
  readonly name: TName
  readonly description: string
  readonly scenarios: TScenarios
}

export type CommandSlice<
  TName extends string = string,
  TInput = unknown,
  TCommand = TInput,
  TWriteState = unknown,
  TReadState = Readonly<TWriteState>,
  TScenarios extends
    NonEmptyScenarios<CommandScenario> = NonEmptyScenarios<CommandScenario>,
  TStore extends
    SliceStoreTag<
      unknown,
      SliceStoreService<TReadState, TWriteState, unknown>
    > = SliceStoreTag<
    unknown,
    SliceStoreService<TReadState, TWriteState, unknown>
  >,
> = SliceBase<TName, TScenarios> & {
  readonly kind: 'command'
  readonly inputSchema?: StandardSchemaV1<TInput, TCommand>
  readonly store: TStore
  readonly apply: readonly ApplyRegistration<TWriteState>[]
  readonly handle: (
    command: TCommand,
    state: TReadState,
  ) => Promise<readonly EventDraft[]>
}

export type QuerySlice<
  TName extends string = string,
  TInput = unknown,
  TQuery = TInput,
  TResult = unknown,
  TOutput = TResult,
  TWriteState = unknown,
  TReadState = Readonly<TWriteState>,
  TScenarios extends
    NonEmptyScenarios<QueryScenario> = NonEmptyScenarios<QueryScenario>,
  TStore extends
    SliceStoreTag<
      unknown,
      SliceStoreService<TReadState, TWriteState, unknown>
    > = SliceStoreTag<
    unknown,
    SliceStoreService<TReadState, TWriteState, unknown>
  >,
> = SliceBase<TName, TScenarios> & {
  readonly kind: 'query'
  readonly inputSchema?: StandardSchemaV1<TInput, TQuery>
  readonly outputSchema?: StandardSchemaV1<TResult, TOutput>
  readonly store: TStore
  readonly apply: readonly ApplyRegistration<TWriteState>[]
  readonly handle: (query: TQuery, state: TReadState) => Promise<TResult>
}

export type QueryRef<TRegistration> =
  TRegistration extends QuerySlice<
    infer TName,
    infer TInput,
    infer _TQuery,
    infer _TResult,
    infer TOutput,
    infer _TWrite,
    infer _TRead,
    infer _TScenarios
  >
    ? {
        name: TName
        result?: TOutput
        input?: TInput
      }
    : never

export type CommandRef<TRegistration> =
  TRegistration extends CommandSlice<
    infer TName,
    infer TInput,
    infer _TCommand,
    infer _TWrite,
    infer _TRead,
    infer _TScenarios
  >
    ? { name: TName; payload?: TInput }
    : never

export type CommandDispatchOptions = {
  readonly expectedVersion?: number
  readonly idempotencyKey?: string
}

export type CommandDispatch = (
  command: CommandEnvelope,
  options?: CommandDispatchOptions,
) => Promise<void>

/**
 * Executes a Reaction effect that may be retried. Plugins should use the stable
 * deliveryId from context as their downstream idempotency key. Durable delivery
 * across process restarts requires a durable scheduler or outbox.
 */
export type ReactionExec<TOutput = unknown> = (
  reaction: TOutput,
  context: ReactionDeliveryContext,
) => Promise<unknown>

export type ReactionPlugin<TOutput = unknown> = (
  command: CommandDispatch,
) => Promise<ReactionExec<TOutput>>

export type ReactionSlice<
  TName extends string = string,
  TResult = CommandEnvelope,
  TOutput = TResult,
  TWriteState = unknown,
  TReadState = Readonly<TWriteState>,
  TScenarios extends
    NonEmptyScenarios<ReactionScenario> = NonEmptyScenarios<ReactionScenario>,
  TStore extends
    SliceStoreTag<
      unknown,
      SliceStoreService<TReadState, TWriteState, unknown>
    > = SliceStoreTag<
    unknown,
    SliceStoreService<TReadState, TWriteState, unknown>
  >,
> = SliceBase<TName, TScenarios> & {
  readonly kind: 'reaction'
  readonly outputSchema?: StandardSchemaV1<TResult, TOutput>
  readonly store: TStore
  readonly apply: readonly ApplyRegistration<TWriteState>[]
  readonly plugin: ReactionPlugin<TOutput>
  readonly handle: (state: TReadState) => Promise<TResult | undefined>
}

// A heterogeneous app registry is an existential type: each Slice keeps its
// own input, output, and state types even though the runtime stores them together.
// biome-ignore lint/suspicious/noExplicitAny: any is the intentional erasure boundary for that existential type.
type ErasedSliceType = any

export type SliceRegistration =
  | CommandSlice<
      string,
      ErasedSliceType,
      ErasedSliceType,
      ErasedSliceType,
      ErasedSliceType,
      ErasedSliceType,
      ErasedSliceType
    >
  | QuerySlice<
      string,
      ErasedSliceType,
      ErasedSliceType,
      ErasedSliceType,
      ErasedSliceType,
      ErasedSliceType,
      ErasedSliceType,
      ErasedSliceType,
      ErasedSliceType
    >
  | ReactionSlice<
      string,
      ErasedSliceType,
      ErasedSliceType,
      ErasedSliceType,
      ErasedSliceType,
      ErasedSliceType,
      ErasedSliceType
    >

export type CommandInputOf<TSlice> =
  TSlice extends CommandSlice<
    infer _TName,
    infer TInput,
    infer _TCommand,
    infer _TWrite,
    infer _TRead,
    infer _TScenarios
  >
    ? TInput
    : never

export type QueryInputOf<TSlice> =
  TSlice extends QuerySlice<
    infer _TName,
    infer TInput,
    infer _TQuery,
    infer _TResult,
    infer _TOutput,
    infer _TWrite,
    infer _TRead,
    infer _TScenarios
  >
    ? TInput
    : never

export type QueryOutputOf<TSlice> =
  TSlice extends QuerySlice<
    infer _TName,
    infer _TInput,
    infer _TQuery,
    infer _TResult,
    infer TOutput,
    infer _TWrite,
    infer _TRead,
    infer _TScenarios
  >
    ? TOutput
    : never
