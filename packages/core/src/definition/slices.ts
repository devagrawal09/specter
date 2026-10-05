import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { SpecificationDigest } from '@specter-ts/spec'
import type { Effect, Scope } from 'effect'

import type { SliceStoreService, SliceStoreTag } from '../adapters/slice-store'
import type {
  Event,
  EventDefinition,
  EventDraft,
  PersistedEvent,
} from './events'
import type {
  CommandScenario,
  NonEmptyScenarios,
  QueryScenario,
  ReactionScenario,
} from './scenario-types'

export type {
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
    CommandScenario | QueryScenario | ReactionScenario
  >,
> = {
  readonly stage: 'implementation'
  readonly name: TName
  readonly description: string
  readonly scenarios: TScenarios
  readonly specificationDigest: SpecificationDigest
  readonly eager: boolean
}

export type SliceStoreOptions = {
  readonly eager?: boolean
}

export type CommandSlice<
  TName extends string = string,
  TInput = unknown,
  TCommand = TInput,
  TWriteState = unknown,
  TReadState = Readonly<TWriteState>,
  TScenarios extends
    NonEmptyScenarios<CommandScenario> = NonEmptyScenarios<CommandScenario>,
  TStore extends SliceStoreTag<
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
  TStore extends SliceStoreTag<
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

/** Commit receipt returned to a Plugin. Nested Reactions are not awaited. */
export type CommandReceipt = {
  readonly events: readonly PersistedEvent[]
  readonly version: number
  /** True when the idempotency key matched an earlier commit. */
  readonly duplicate: boolean
}

export type CommandDispatch = (
  command: CommandEnvelope,
  options?: CommandDispatchOptions,
) => Effect.Effect<CommandReceipt, unknown>

type AnyQuerySlice = Extract<SliceRegistration, { readonly kind: 'query' }>

/**
 * Runs a registered Query in the same app. The Query Slice value supplies the
 * name and types; dispatch is by name. Queries fail inside a direct Plugin's
 * Reaction transaction; run them from an outboxed Plugin.
 */
export type QueryDispatch = <const TQuery extends AnyQuerySlice>(
  query: TQuery,
  input: QueryInputOf<TQuery>,
) => Effect.Effect<QueryOutputOf<TQuery>, unknown>

/** Same-app capabilities supplied once to a Plugin factory. */
export type ReactionPluginContext = {
  readonly command: CommandDispatch
  readonly query: QueryDispatch
}

export type ReactionDeliveryContext = {
  /** Stable for one Reaction Slice processing one Event Log commit. */
  readonly deliveryId: string
  readonly throughOrder: number
  readonly scheduledAt: string
}

/**
 * Executes a Reaction effect that may be retried. Plugins should use the stable
 * deliveryId from context as their downstream idempotency key. Reaction Slice
 * cursor rollback retries failures. Slow external effects may use an outbox.
 */
export type ReactionExec<TOutput = unknown> = (
  reaction: TOutput,
  context: ReactionDeliveryContext,
) => Effect.Effect<void, unknown>

/**
 * Initializes once in the app scope. `R` lists the Effect services the factory
 * reads; the app's dependency Layer must provide them. Scope is always
 * available and is not an app requirement.
 */
export type ReactionPlugin<TOutput = unknown, R = never> = (
  context: ReactionPluginContext,
) => Effect.Effect<ReactionExec<TOutput>, unknown, R | Scope.Scope>

/** Effect services a Reaction Plugin requires from the app, excluding Scope. */
export type ReactionPluginRequirements<TSlice> = TSlice extends {
  readonly kind: 'reaction'
  readonly plugin?: infer TPlugin
}
  ? NonNullable<TPlugin> extends (
      context: ReactionPluginContext,
    ) => Effect.Effect<infer _TExec, infer _TError, infer R>
    ? Exclude<R, Scope.Scope>
    : never
  : never

export type ReactionSlice<
  TName extends string = string,
  TResult = CommandEnvelope,
  TOutput = TResult,
  TWriteState = unknown,
  TReadState = Readonly<TWriteState>,
  TScenarios extends
    NonEmptyScenarios<ReactionScenario> = NonEmptyScenarios<ReactionScenario>,
  TStore extends SliceStoreTag<
    unknown,
    SliceStoreService<TReadState, TWriteState, unknown>
  > = SliceStoreTag<
    unknown,
    SliceStoreService<TReadState, TWriteState, unknown>
  >,
  TPluginRequirements = never,
> = SliceBase<TName, TScenarios> & {
  readonly kind: 'reaction'
  readonly outputSchema?: StandardSchemaV1<TResult, TOutput>
  readonly store: TStore
  readonly apply: readonly ApplyRegistration<TWriteState>[]
  readonly plugin?: ReactionPlugin<TOutput, TPluginRequirements>
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
