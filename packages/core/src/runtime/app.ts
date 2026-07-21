import type { Layer } from 'effect'

import type { EventLogAdapter, ReactionScheduler } from '../adapters'
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
  type SpecterStoreRequirements,
} from '../effect/runtime'

export type SpecterObservation =
  | {
      readonly type: 'slice-caught-up'
      readonly sliceName: string
      readonly fromOrder: number
      readonly toOrder: number
      readonly eventCount: number
    }
  | {
      readonly type: 'command-committed'
      readonly commandType: string
      readonly version: number
      readonly eventCount: number
      readonly duplicate: boolean
    }
  | {
      readonly type: 'subscriptions-invalidated'
      readonly queryName: string
      readonly subscriberCount: number
    }
  | {
      readonly type: 'reaction-run-started'
      readonly reactionName: string
    }
  | {
      readonly type: 'reaction-run-completed'
      readonly reactionName: string
      readonly durationMs: number
    }
  | {
      readonly type: 'reaction-run-failed'
      readonly reactionName: string
      readonly durationMs: number
      readonly cause: unknown
    }
  | {
      readonly type: 'reaction-pass-completed'
      readonly failureCount: number
    }

export type SpecterObserver = (observation: SpecterObservation) => void

export type SpecterAppConfig = {
  readonly events: readonly ApplyEventDefinition[]
  readonly eventLog: EventLogAdapter
  readonly schedule: ReactionScheduler
  readonly slices: readonly SliceRegistration[]
  readonly warmupSlices?: readonly string[]
  readonly observe?: SpecterObserver
  readonly dispose?: () => Promise<void>
}

type CommandRegistration<TConfig extends SpecterAppConfig> = Extract<
  TConfig['slices'][number],
  { kind: 'command' }
>

type QueryRegistration<TConfig extends SpecterAppConfig> = Extract<
  TConfig['slices'][number],
  { kind: 'query' }
>

type CommandEnvelopeFor<TCommand> =
  TCommand extends CommandSlice<
    infer TName,
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
    infer TName,
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
        readonly type: TName
        readonly payload: TInput
      }
    : never

export type SpecterCommandEnvelope<TConfig extends SpecterAppConfig> =
  CommandEnvelopeFor<CommandRegistration<TConfig>>

export type SpecterQueryEnvelope<TConfig extends SpecterAppConfig> =
  QueryEnvelopeFor<QueryRegistration<TConfig>>

export type SpecterCommandType<TConfig extends SpecterAppConfig> =
  SpecterCommandEnvelope<TConfig>['type']

export type SpecterQueryType<TConfig extends SpecterAppConfig> =
  SpecterQueryEnvelope<TConfig>['type']

export type SpecterQueryResult<
  TConfig extends SpecterAppConfig,
  TType extends SpecterQueryType<TConfig>,
> =
  Extract<QueryRegistration<TConfig>, { name: TType }> extends QuerySlice<
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
  stores: Layer.Layer<SpecterStoreRequirements<TConfig>>,
): Promise<SpecterApp<TConfig>> {
  return Promise.resolve(createSpecterPromiseApp(config, stores))
}
