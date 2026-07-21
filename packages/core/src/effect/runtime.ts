import { Context, Effect, Layer, Stream } from 'effect'

import { SpecterConformanceError, type CommandEnvelope } from '../definition'
import {
  createSpecterApp,
  type CommandExecution,
  type CommandExecutionOptions,
  type SpecterApp,
  type SpecterAppConfig,
  type SpecterCommandEnvelope,
  type SpecterQueryEnvelope,
  type SpecterQueryResult,
} from '../runtime'
import {
  ReactionRunFailure,
  SpecterError,
  SpecterInfrastructureError,
} from '../runtime'

export type SpecterEffectError =
  | SpecterError
  | SpecterConformanceError
  | ReactionRunFailure

export type SpecterEffectApp<TConfig extends SpecterAppConfig> = {
  readonly command: <const TCommand extends SpecterCommandEnvelope<TConfig>>(
    command: TCommand,
    options?: CommandExecutionOptions,
  ) => Effect.Effect<CommandExecution, SpecterEffectError>
  readonly query: <const TQuery extends SpecterQueryEnvelope<TConfig>>(
    query: TQuery,
  ) => Effect.Effect<
    SpecterQueryResult<TConfig, TQuery['type']>,
    SpecterEffectError
  >
  readonly subscribe: <const TQuery extends SpecterQueryEnvelope<TConfig>>(
    query: TQuery,
  ) => Stream.Stream<
    SpecterQueryResult<TConfig, TQuery['type']>,
    SpecterEffectError
  >
  readonly close: Effect.Effect<void, SpecterEffectError>
  readonly unsafePromiseApp: SpecterApp<TConfig>
}

export type SpecterRuntimeService = {
  readonly command: (
    command: CommandEnvelope,
    options?: CommandExecutionOptions,
  ) => Effect.Effect<CommandExecution, SpecterEffectError>
  readonly query: (
    query: CommandEnvelope,
  ) => Effect.Effect<unknown, SpecterEffectError>
  readonly subscribe: (
    query: CommandEnvelope,
  ) => Stream.Stream<unknown, SpecterEffectError>
}

export const SpecterRuntime = Context.GenericTag<SpecterRuntimeService>(
  '@specter-ts/core/SpecterRuntime',
)

/**
 * Builds a typed Effect-native facade. Promise conversion stays at this single
 * runtime edge; application services can compose commands, queries, and
 * subscriptions without calling `Effect.runPromise` in individual adapters.
 */
export function createSpecterAppEffect<const TConfig extends SpecterAppConfig>(
  config: TConfig,
): Effect.Effect<SpecterEffectApp<TConfig>, SpecterEffectError> {
  return Effect.map(
    Effect.tryPromise({
      try: () => createSpecterApp(config),
      catch: toSpecterEffectError,
    }),
    fromPromiseApp,
  )
}

/** Acquires and releases one Specter app inside the surrounding Effect Scope. */
export function createSpecterAppLayer<
  const TConfig extends SpecterAppConfig,
  E,
  R,
>(
  config: Effect.Effect<TConfig, E, R>,
): Layer.Layer<SpecterRuntimeService, E | SpecterEffectError, R> {
  return Layer.scoped(
    SpecterRuntime,
    Effect.acquireRelease(
      Effect.map(
        Effect.flatMap(config, createSpecterAppEffect),
        toRuntimeService,
      ),
      (app) => Effect.orDie(app.close),
    ),
  )
}

function toRuntimeService<const TConfig extends SpecterAppConfig>(
  app: SpecterEffectApp<TConfig>,
): SpecterRuntimeService & {
  readonly close: Effect.Effect<void, SpecterEffectError>
} {
  return {
    command: (command, options) =>
      Effect.tryPromise({
        try: () => app.unsafePromiseApp.command(command as never, options),
        catch: toSpecterEffectError,
      }),
    query: (query) =>
      Effect.tryPromise({
        try: () => app.unsafePromiseApp.query(query as never),
        catch: toSpecterEffectError,
      }),
    subscribe: (query) =>
      Stream.fromAsyncIterable(
        app.unsafePromiseApp.subscribe(query as never),
        toSpecterEffectError,
      ),
    close: app.close,
  }
}

function fromPromiseApp<const TConfig extends SpecterAppConfig>(
  app: SpecterApp<TConfig>,
): SpecterEffectApp<TConfig> {
  return Object.freeze({
    command: (command, options) =>
      Effect.tryPromise({
        try: () => app.command(command, options),
        catch: toSpecterEffectError,
      }),
    query: (query) =>
      Effect.tryPromise({
        try: () => app.query(query),
        catch: toSpecterEffectError,
      }),
    subscribe: (query) =>
      Stream.fromAsyncIterable(app.subscribe(query), toSpecterEffectError),
    close: Effect.tryPromise({
      try: () => app.close(),
      catch: toSpecterEffectError,
    }),
    unsafePromiseApp: app,
  })
}

function toSpecterEffectError(cause: unknown): SpecterEffectError {
  if (
    cause instanceof SpecterError ||
    cause instanceof SpecterConformanceError ||
    cause instanceof ReactionRunFailure
  ) {
    return cause
  }
  return new SpecterInfrastructureError(
    'An unexpected failure crossed the Effect runtime boundary.',
    cause,
  )
}
