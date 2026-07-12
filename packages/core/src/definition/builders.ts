import type { StandardSchemaV1 } from '@standard-schema/spec'

import type { EventDraft } from './events'
import type {
  CommandScenario,
  NonEmptyScenarios,
  QueryScenario,
  ReactionScenario,
  SliceScenario,
} from './scenario-types'
import type {
  ApplyEventDefinition,
  ApplyRegistration,
  CommandSlice,
  EventForDefinition,
  QuerySlice,
  ReactionPlugin,
  ReactionSlice,
  SliceStoreAdapter,
} from './slices'

type CommandDescriptionStep<TName extends string> = {
  description: (description: string) => CommandScenariosStep<TName>
}

type CommandScenariosStep<TName extends string> = {
  scenarios: <const TScenarios extends NonEmptyScenarios<CommandScenario>>(
    ...scenarios: TScenarios
  ) => CommandSliceSpec<TName, TScenarios>
}

export type CommandSliceSpec<
  TName extends string = string,
  TScenarios extends
    NonEmptyScenarios<CommandScenario> = NonEmptyScenarios<CommandScenario>,
> = {
  readonly stage: 'specification'
  readonly kind: 'command'
  readonly name: TName
  readonly description: string
  readonly scenarios: TScenarios
  inputSchema<TInput = unknown>(): CommandStoreStep<
    TName,
    TInput,
    TInput,
    TScenarios
  >
  inputSchema<TSchema extends StandardSchemaV1>(
    schema: TSchema,
  ): CommandStoreStep<
    TName,
    StandardSchemaV1.InferInput<TSchema>,
    StandardSchemaV1.InferOutput<TSchema>,
    TScenarios
  >
}

type CommandStoreStep<
  TName extends string,
  TInput,
  TCommand,
  TScenarios extends NonEmptyScenarios<CommandScenario>,
> = {
  store: <TWriteState, TReadState = TWriteState>(
    store: SliceStoreAdapter<TWriteState, TReadState>,
  ) => CommandApplyStep<
    TName,
    TInput,
    TCommand,
    TWriteState,
    TReadState,
    TScenarios
  >
}

type CommandApplyStep<
  TName extends string,
  TInput,
  TCommand,
  TWriteState,
  TReadState,
  TScenarios extends NonEmptyScenarios<CommandScenario>,
> = {
  apply: <TDefinition extends ApplyEventDefinition>(
    definition: TDefinition,
    handle: (
      event: EventForDefinition<TDefinition>,
      state: TWriteState,
    ) => Promise<void>,
  ) => CommandApplyStep<
    TName,
    TInput,
    TCommand,
    TWriteState,
    TReadState,
    TScenarios
  >
  handle: (
    handle: (
      command: TCommand,
      state: TReadState,
    ) => Promise<readonly EventDraft[]>,
  ) => CommandSlice<
    TName,
    TInput,
    TCommand,
    TWriteState,
    TReadState,
    TScenarios
  >
}

type QueryDescriptionStep<TName extends string> = {
  description: (description: string) => QueryScenariosStep<TName>
}

type QueryScenariosStep<TName extends string> = {
  scenarios: <const TScenarios extends NonEmptyScenarios<QueryScenario>>(
    ...scenarios: TScenarios
  ) => QuerySliceSpec<TName, TScenarios>
}

export type QuerySliceSpec<
  TName extends string = string,
  TScenarios extends
    NonEmptyScenarios<QueryScenario> = NonEmptyScenarios<QueryScenario>,
> = {
  readonly stage: 'specification'
  readonly kind: 'query'
  readonly name: TName
  readonly description: string
  readonly scenarios: TScenarios
  inputSchema<TInput = unknown>(): QueryOutputSchemaStep<
    TName,
    TInput,
    TInput,
    TScenarios
  >
  inputSchema<TSchema extends StandardSchemaV1>(
    schema: TSchema,
  ): QueryOutputSchemaStep<
    TName,
    StandardSchemaV1.InferInput<TSchema>,
    StandardSchemaV1.InferOutput<TSchema>,
    TScenarios
  >
}

type QueryOutputSchemaStep<
  TName extends string,
  TInput,
  TQuery,
  TScenarios extends NonEmptyScenarios<QueryScenario>,
> = {
  outputSchema<TResult = unknown>(): QueryStoreStep<
    TName,
    TInput,
    TQuery,
    TResult,
    TResult,
    TScenarios
  >
  outputSchema<TSchema extends StandardSchemaV1>(
    schema: TSchema,
  ): QueryStoreStep<
    TName,
    TInput,
    TQuery,
    StandardSchemaV1.InferInput<TSchema>,
    StandardSchemaV1.InferOutput<TSchema>,
    TScenarios
  >
}

type QueryStoreStep<
  TName extends string,
  TInput,
  TQuery,
  TResult,
  TOutput,
  TScenarios extends NonEmptyScenarios<QueryScenario>,
> = {
  store: <TWriteState, TReadState = TWriteState>(
    store: SliceStoreAdapter<TWriteState, TReadState>,
  ) => QueryApplyStep<
    TName,
    TInput,
    TQuery,
    TResult,
    TOutput,
    TWriteState,
    TReadState,
    TScenarios
  >
}

type QueryApplyStep<
  TName extends string,
  TInput,
  TQuery,
  TResult,
  TOutput,
  TWriteState,
  TReadState,
  TScenarios extends NonEmptyScenarios<QueryScenario>,
> = {
  apply: <TDefinition extends ApplyEventDefinition>(
    definition: TDefinition,
    handle: (
      event: EventForDefinition<TDefinition>,
      state: TWriteState,
    ) => Promise<void>,
  ) => QueryApplyStep<
    TName,
    TInput,
    TQuery,
    TResult,
    TOutput,
    TWriteState,
    TReadState,
    TScenarios
  >
  handle: (
    handle: (query: TQuery, state: TReadState) => Promise<TResult>,
  ) => QuerySlice<
    TName,
    TInput,
    TQuery,
    TResult,
    TOutput,
    TWriteState,
    TReadState,
    TScenarios
  >
}

type ReactionDescriptionStep<TName extends string> = {
  description: (description: string) => ReactionScenariosStep<TName>
}

type ReactionScenariosStep<TName extends string> = {
  scenarios: <const TScenarios extends NonEmptyScenarios<ReactionScenario>>(
    ...scenarios: TScenarios
  ) => ReactionSliceSpec<TName, TScenarios>
}

export type ReactionSliceSpec<
  TName extends string = string,
  TScenarios extends
    NonEmptyScenarios<ReactionScenario> = NonEmptyScenarios<ReactionScenario>,
> = {
  readonly stage: 'specification'
  readonly kind: 'reaction'
  readonly name: TName
  readonly description: string
  readonly scenarios: TScenarios
  outputSchema<TResult = unknown>(): ReactionPluginStep<
    TName,
    TResult,
    TResult,
    TScenarios
  >
  outputSchema<TSchema extends StandardSchemaV1>(
    schema: TSchema,
  ): ReactionPluginStep<
    TName,
    StandardSchemaV1.InferInput<TSchema>,
    StandardSchemaV1.InferOutput<TSchema>,
    TScenarios
  >
}

type ReactionPluginStep<
  TName extends string,
  TResult,
  TOutput,
  TScenarios extends NonEmptyScenarios<ReactionScenario>,
> = {
  plugin: (
    plugin: ReactionPlugin<TOutput>,
  ) => ReactionStoreStep<TName, TResult, TOutput, TScenarios>
}

type ReactionStoreStep<
  TName extends string,
  TResult,
  TOutput,
  TScenarios extends NonEmptyScenarios<ReactionScenario>,
> = {
  store: <TWriteState, TReadState = TWriteState>(
    store: SliceStoreAdapter<TWriteState, TReadState>,
  ) => ReactionApplyStep<
    TName,
    TResult,
    TOutput,
    TWriteState,
    TReadState,
    TScenarios
  >
}

type ReactionApplyStep<
  TName extends string,
  TResult,
  TOutput,
  TWriteState,
  TReadState,
  TScenarios extends NonEmptyScenarios<ReactionScenario>,
> = {
  apply: <TDefinition extends ApplyEventDefinition>(
    definition: TDefinition,
    handle: (
      event: EventForDefinition<TDefinition>,
      state: TWriteState,
    ) => Promise<void>,
  ) => ReactionApplyStep<
    TName,
    TResult,
    TOutput,
    TWriteState,
    TReadState,
    TScenarios
  >
  handle: (
    handle: (state: TReadState) => Promise<TResult | undefined>,
  ) => ReactionSlice<
    TName,
    TResult,
    TOutput,
    TWriteState,
    TReadState,
    TScenarios
  >
}

type Specification<
  TKind extends 'command' | 'query' | 'reaction',
  TName extends string,
  TScenarios extends NonEmptyScenarios<SliceScenario>,
> = {
  readonly stage: 'specification'
  readonly kind: TKind
  readonly name: TName
  readonly description: string
  readonly scenarios: TScenarios
}

export function createCommandSlice<const TName extends string>(
  name: TName,
): CommandDescriptionStep<TName> {
  return Object.freeze({
    description: (description: string) => ({
      scenarios: (...scenarios) =>
        createCommandSpec(name, description, freezeScenarios(scenarios)),
    }),
  })
}

function createCommandSpec<
  TName extends string,
  TScenarios extends NonEmptyScenarios<CommandScenario>,
>(
  name: TName,
  description: string,
  scenarios: TScenarios,
): CommandSliceSpec<TName, TScenarios> {
  const specification = Object.freeze({
    stage: 'specification' as const,
    kind: 'command' as const,
    name,
    description,
    scenarios,
  })

  return Object.freeze({
    ...specification,
    inputSchema: (schema?: StandardSchemaV1) => ({
      store: <TWriteState, TReadState = TWriteState>(
        store: SliceStoreAdapter<TWriteState, TReadState>,
      ) =>
        createCommandApplyStep(specification, schema, store, Object.freeze([])),
    }),
  }) as CommandSliceSpec<TName, TScenarios>
}

function createCommandApplyStep<
  TName extends string,
  TInput,
  TCommand,
  TWriteState,
  TReadState,
  TScenarios extends NonEmptyScenarios<CommandScenario>,
>(
  specification: Specification<'command', TName, TScenarios>,
  inputSchema: StandardSchemaV1<TInput, TCommand> | undefined,
  store: SliceStoreAdapter<TWriteState, TReadState>,
  apply: readonly ApplyRegistration<TWriteState>[],
): CommandApplyStep<
  TName,
  TInput,
  TCommand,
  TWriteState,
  TReadState,
  TScenarios
> {
  return Object.freeze({
    apply: <TDefinition extends ApplyEventDefinition>(
      definition: TDefinition,
      handle: (
        event: EventForDefinition<TDefinition>,
        state: TWriteState,
      ) => Promise<void>,
    ) =>
      createCommandApplyStep(specification, inputSchema, store, [
        ...apply,
        { event: definition, handle } as ApplyRegistration<TWriteState>,
      ]),
    handle: (
      handle: (
        command: TCommand,
        state: TReadState,
      ) => Promise<readonly EventDraft[]>,
    ) =>
      Object.freeze({
        ...specification,
        stage: 'implementation' as const,
        inputSchema,
        store,
        apply: Object.freeze([...apply]),
        handle,
      }),
  })
}

export function createQuerySlice<const TName extends string>(
  name: TName,
): QueryDescriptionStep<TName> {
  return Object.freeze({
    description: (description: string) => ({
      scenarios: (...scenarios) =>
        createQuerySpec(name, description, freezeScenarios(scenarios)),
    }),
  })
}

function createQuerySpec<
  TName extends string,
  TScenarios extends NonEmptyScenarios<QueryScenario>,
>(
  name: TName,
  description: string,
  scenarios: TScenarios,
): QuerySliceSpec<TName, TScenarios> {
  const specification = Object.freeze({
    stage: 'specification' as const,
    kind: 'query' as const,
    name,
    description,
    scenarios,
  })

  return Object.freeze({
    ...specification,
    inputSchema: (inputSchema?: StandardSchemaV1) => ({
      outputSchema: (outputSchema?: StandardSchemaV1) => ({
        store: <TWriteState, TReadState = TWriteState>(
          store: SliceStoreAdapter<TWriteState, TReadState>,
        ) =>
          createQueryApplyStep(
            specification,
            inputSchema,
            outputSchema,
            store,
            Object.freeze([]),
          ),
      }),
    }),
  }) as QuerySliceSpec<TName, TScenarios>
}

function createQueryApplyStep<
  TName extends string,
  TInput,
  TQuery,
  TResult,
  TOutput,
  TWriteState,
  TReadState,
  TScenarios extends NonEmptyScenarios<QueryScenario>,
>(
  specification: Specification<'query', TName, TScenarios>,
  inputSchema: StandardSchemaV1<TInput, TQuery> | undefined,
  outputSchema: StandardSchemaV1<TResult, TOutput> | undefined,
  store: SliceStoreAdapter<TWriteState, TReadState>,
  apply: readonly ApplyRegistration<TWriteState>[],
): QueryApplyStep<
  TName,
  TInput,
  TQuery,
  TResult,
  TOutput,
  TWriteState,
  TReadState,
  TScenarios
> {
  return Object.freeze({
    apply: <TDefinition extends ApplyEventDefinition>(
      definition: TDefinition,
      handle: (
        event: EventForDefinition<TDefinition>,
        state: TWriteState,
      ) => Promise<void>,
    ) =>
      createQueryApplyStep(specification, inputSchema, outputSchema, store, [
        ...apply,
        { event: definition, handle } as ApplyRegistration<TWriteState>,
      ]),
    handle: (handle: (query: TQuery, state: TReadState) => Promise<TResult>) =>
      Object.freeze({
        ...specification,
        stage: 'implementation' as const,
        inputSchema,
        outputSchema,
        store,
        apply: Object.freeze([...apply]),
        handle,
      }),
  })
}

export function createReactionSlice<const TName extends string>(
  name: TName,
): ReactionDescriptionStep<TName> {
  return Object.freeze({
    description: (description: string) => ({
      scenarios: (...scenarios) =>
        createReactionSpec(name, description, freezeScenarios(scenarios)),
    }),
  })
}

function createReactionSpec<
  TName extends string,
  TScenarios extends NonEmptyScenarios<ReactionScenario>,
>(
  name: TName,
  description: string,
  scenarios: TScenarios,
): ReactionSliceSpec<TName, TScenarios> {
  const specification = Object.freeze({
    stage: 'specification' as const,
    kind: 'reaction' as const,
    name,
    description,
    scenarios,
  })

  return Object.freeze({
    ...specification,
    outputSchema: (outputSchema?: StandardSchemaV1) => ({
      plugin: (plugin: ReactionPlugin) => ({
        store: <TWriteState, TReadState = TWriteState>(
          store: SliceStoreAdapter<TWriteState, TReadState>,
        ) =>
          createReactionApplyStep(
            specification,
            outputSchema,
            plugin,
            store,
            Object.freeze([]),
          ),
      }),
    }),
  }) as ReactionSliceSpec<TName, TScenarios>
}

function createReactionApplyStep<
  TName extends string,
  TResult,
  TOutput,
  TWriteState,
  TReadState,
  TScenarios extends NonEmptyScenarios<ReactionScenario>,
>(
  specification: Specification<'reaction', TName, TScenarios>,
  outputSchema: StandardSchemaV1<TResult, TOutput> | undefined,
  plugin: ReactionPlugin<TOutput>,
  store: SliceStoreAdapter<TWriteState, TReadState>,
  apply: readonly ApplyRegistration<TWriteState>[],
): ReactionApplyStep<
  TName,
  TResult,
  TOutput,
  TWriteState,
  TReadState,
  TScenarios
> {
  return Object.freeze({
    apply: <TDefinition extends ApplyEventDefinition>(
      definition: TDefinition,
      handle: (
        event: EventForDefinition<TDefinition>,
        state: TWriteState,
      ) => Promise<void>,
    ) =>
      createReactionApplyStep(specification, outputSchema, plugin, store, [
        ...apply,
        { event: definition, handle } as ApplyRegistration<TWriteState>,
      ]),
    handle: (handle: (state: TReadState) => Promise<TResult | undefined>) =>
      Object.freeze({
        ...specification,
        stage: 'implementation' as const,
        outputSchema,
        plugin,
        store,
        apply: Object.freeze([...apply]),
        handle,
      }),
  })
}

function freezeScenarios<const TScenarios extends readonly SliceScenario[]>(
  scenarios: TScenarios,
): TScenarios {
  return Object.freeze(
    scenarios.map((scenario) =>
      Object.freeze({
        ...scenario,
        given: Object.freeze([...scenario.given]),
        ...(Array.isArray(scenario.expect)
          ? { expect: Object.freeze([...scenario.expect]) }
          : {}),
      }),
    ),
  ) as unknown as TScenarios
}
