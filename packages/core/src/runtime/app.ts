import type { Layer } from 'effect'

import type {
  ApplyEventDefinition,
  CommandDispatchOptions,
  CommandSlice,
  PersistedEvent,
  QuerySlice,
  SliceRegistration,
} from '../definition'
import {
  createSpecterPromiseApp,
  type SpecterRuntimeRequirements,
} from '../effect/runtime'

export type SpecterAppConfig = {
  readonly events: readonly ApplyEventDefinition[]
  readonly slices: Readonly<Record<string, SliceRegistration>>
}

type SliceKeyOfKind<
  TConfig extends SpecterAppConfig,
  TKind extends SliceRegistration['kind'],
> = {
  [TKey in keyof TConfig['slices'] & string]: TConfig['slices'][TKey] extends {
    readonly kind: TKind
  }
    ? TKey
    : never
}[keyof TConfig['slices'] & string]

type CommandEnvelopeFor<TName extends string, TCommand> =
  TCommand extends CommandSlice<
    infer _TName,
    infer TInput,
    infer _TCommand,
    infer _TWriteState,
    infer _TReadState,
    infer _TScenarios,
    infer _TStore
  >
    ? {
        readonly type: TName
        readonly payload: TInput
      }
    : never

type QueryEnvelopeFor<TQuery> =
  TQuery extends QuerySlice<
    infer _TName,
    infer TInput,
    infer _TQuery,
    infer _TResult,
    infer _TOutput,
    infer _TWriteState,
    infer _TReadState,
    infer _TScenarios,
    infer _TStore
  >
    ? {
        readonly type: never
        readonly payload: TInput
      }
    : never

type QueryEnvelopeForKey<TName extends string, TQuery> =
  QueryEnvelopeFor<TQuery> extends infer TEnvelope
    ? TEnvelope extends { readonly payload: infer TPayload }
      ? { readonly type: TName; readonly payload: TPayload }
      : never
    : never

export type SpecterCommandEnvelope<TConfig extends SpecterAppConfig> = {
  [TName in SliceKeyOfKind<TConfig, 'command'>]: CommandEnvelopeFor<
    TName,
    TConfig['slices'][TName]
  >
}[SliceKeyOfKind<TConfig, 'command'>]

export type SpecterQueryEnvelope<TConfig extends SpecterAppConfig> = {
  [TName in SliceKeyOfKind<TConfig, 'query'>]: QueryEnvelopeForKey<
    TName,
    TConfig['slices'][TName]
  >
}[SliceKeyOfKind<TConfig, 'query'>]

export type SpecterCommandType<TConfig extends SpecterAppConfig> =
  SpecterCommandEnvelope<TConfig>['type']

export type SpecterQueryType<TConfig extends SpecterAppConfig> =
  SpecterQueryEnvelope<TConfig>['type']

export type SpecterQueryResult<
  TConfig extends SpecterAppConfig,
  TType extends SpecterQueryType<TConfig>,
> =
  TConfig['slices'][TType] extends QuerySlice<
    infer _TName,
    infer _TInput,
    infer _TQuery,
    infer _TResult,
    infer TOutput,
    infer _TWriteState,
    infer _TReadState,
    infer _TScenarios,
    infer _TStore
  >
    ? TOutput
    : never

export type CommandExecutionOptions = CommandDispatchOptions

export type CommandExecution = {
  readonly operationId?: string
  readonly events: readonly PersistedEvent[]
  readonly version: number
  readonly duplicate: boolean
  readonly reactions: Promise<void>
}

export type QuerySubscriptionOptions = {
  readonly signal?: AbortSignal
}

declare const specterAppConfig: unique symbol

export type SpecterApp<TConfig extends SpecterAppConfig> = {
  readonly [specterAppConfig]?: TConfig
  command: <const TCommand extends SpecterCommandEnvelope<TConfig>>(
    command: TCommand,
    options?: CommandExecutionOptions,
  ) => Promise<CommandExecution>
  query: <const TQuery extends SpecterQueryEnvelope<TConfig>>(
    query: TQuery,
  ) => Promise<SpecterQueryResult<TConfig, TQuery['type']>>
  subscribe: <const TQuery extends SpecterQueryEnvelope<TConfig>>(
    query: TQuery,
    options?: QuerySubscriptionOptions,
  ) => AsyncIterable<SpecterQueryResult<TConfig, TQuery['type']>>
  close: () => Promise<void>
}

export type SpecterAppConfigOf<TApp> =
  TApp extends SpecterApp<infer TConfig> ? TConfig : never

/** Promise transport edge. Runtime semantics remain in Effect interpreter. */
export function createSpecterApp<const TConfig extends SpecterAppConfig>(
  config: TConfig,
  dependencies: Layer.Layer<SpecterRuntimeRequirements<TConfig>>,
): Promise<SpecterApp<TConfig>> {
  return Promise.resolve(createSpecterPromiseApp(config, dependencies))
}
