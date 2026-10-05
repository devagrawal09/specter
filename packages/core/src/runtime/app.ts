import { Effect, type Layer } from 'effect'

import type {
  ApplyEventDefinition,
  CommandDispatchOptions,
  CommandSlice,
  PersistedEvent,
  QuerySlice,
  SliceRegistration,
} from '../definition'
import {
  startSpecterPromiseApp,
  prepareSpecterRuntime,
  type SpecterRuntimeRequirements,
} from '../effect/runtime'

export type SpecterAppConfig = {
  readonly events: readonly ApplyEventDefinition[]
  readonly slices: Readonly<Record<string, SliceRegistration>>
}

declare const preparedSpecterApp: unique symbol

/**
 * A config that already passed conformance, with its lookup structures built.
 * Accepted wherever a config is; bind it to any number of Event Logs. Only
 * `prepareSpecterApp` / `prepareSpecterRuntime` create one.
 */
export type PreparedSpecterApp<
  TConfig extends SpecterAppConfig = SpecterAppConfig,
> = {
  readonly _tag: 'PreparedSpecterApp'
  readonly config: TConfig
  readonly [preparedSpecterApp]: true
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

/**
 * Runs conformance once for a config and builds its lookup structures. The
 * result is cached by the identity of `config.events` and `config.slices`, so
 * calling this (or `createSpecterApp`) again with the same objects is free.
 * Rejects with `SpecterConformanceError` for an invalid config.
 */
export function prepareSpecterApp<const TConfig extends SpecterAppConfig>(
  config: TConfig | PreparedSpecterApp<TConfig>,
): Promise<PreparedSpecterApp<TConfig>> {
  return Effect.runPromise(prepareSpecterRuntime(config))
}

/**
 * Promise transport edge. Runtime semantics remain in Effect interpreter.
 *
 * Validates the config (cached per config), then binds it to `dependencies`:
 * Store resolution, scheduler binding, and Reaction and eager-Slice catch-up.
 * Resolves once the app is ready; any construction failure rejects this
 * Promise and releases the partially built runtime.
 */
export async function createSpecterApp<const TConfig extends SpecterAppConfig>(
  config: TConfig | PreparedSpecterApp<TConfig>,
  dependencies: Layer.Layer<SpecterRuntimeRequirements<TConfig>>,
): Promise<SpecterApp<TConfig>> {
  const prepared = await prepareSpecterApp(config)
  const { app, ready } = startSpecterPromiseApp(prepared, dependencies)
  try {
    await ready
  } catch (cause) {
    // A failing cleanup must not replace the startup failure.
    await app.close().catch(() => undefined)
    throw cause
  }
  return app
}
