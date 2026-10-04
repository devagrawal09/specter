import type { StandardSchemaV1 } from '@standard-schema/spec'
import {
  digestSpecification,
  parseSpecification,
  parseSpecificationJson,
  SPECTER_SPECIFICATION_FORMAT_VERSION,
  SPECTER_SPECIFICATION_SCHEMA,
  type SpecificationDigest,
} from '@specter-ts/spec'

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
  CommandEnvelope,
  CommandSlice,
  EventForDefinition,
  QuerySlice,
  ReactionPlugin,
  ReactionSlice,
  SliceStoreOptions,
} from './slices'
import type {
  SliceStoreRead,
  SliceStoreService,
  SliceStoreTag,
  SliceStoreWrite,
} from '../adapters/slice-store'

type StoreBinding = SliceStoreTag<unknown, SliceStoreService<any, any, any>>

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
  store: <TStore extends StoreBinding>(
    store: TStore,
    options?: SliceStoreOptions,
  ) => CommandApplyStep<
    TName,
    TInput,
    TCommand,
    SliceStoreWrite<TStore>,
    SliceStoreRead<TStore>,
    TScenarios,
    TStore
  >
}

type CommandApplyStep<
  TName extends string,
  TInput,
  TCommand,
  TWriteState,
  TReadState,
  TScenarios extends NonEmptyScenarios<CommandScenario>,
  TStore extends StoreBinding,
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
    TScenarios,
    TStore
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
    TScenarios,
    TStore
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
  store: <TStore extends StoreBinding>(
    store: TStore,
    options?: SliceStoreOptions,
  ) => QueryApplyStep<
    TName,
    TInput,
    TQuery,
    TResult,
    TOutput,
    SliceStoreWrite<TStore>,
    SliceStoreRead<TStore>,
    TScenarios,
    TStore
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
  TStore extends StoreBinding,
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
    TScenarios,
    TStore
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
    TScenarios,
    TStore
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
  outputSchema<TResult = CommandEnvelope>(): ReactionPluginStep<
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
} & (TOutput extends CommandEnvelope
  ? ReactionStoreStep<TName, TResult, TOutput, TScenarios>
  : {})

type ReactionStoreStep<
  TName extends string,
  TResult,
  TOutput,
  TScenarios extends NonEmptyScenarios<ReactionScenario>,
> = {
  store: <TStore extends StoreBinding>(
    store: TStore,
    options?: SliceStoreOptions,
  ) => ReactionApplyStep<
    TName,
    TResult,
    TOutput,
    SliceStoreWrite<TStore>,
    SliceStoreRead<TStore>,
    TScenarios,
    TStore
  >
}

type ReactionApplyStep<
  TName extends string,
  TResult,
  TOutput,
  TWriteState,
  TReadState,
  TScenarios extends NonEmptyScenarios<ReactionScenario>,
  TStore extends StoreBinding,
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
    TScenarios,
    TStore
  >
  handle: (
    handle: (state: TReadState) => Promise<TResult | undefined>,
  ) => ReactionSlice<
    TName,
    TResult,
    TOutput,
    TWriteState,
    TReadState,
    TScenarios,
    TStore
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
  readonly specificationDigest: SpecificationDigest
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

export function implementCommand(input: unknown): CommandSliceSpec<string> {
  const specification = loadSpecification(input)
  if (specification.kind !== 'command')
    throw new Error(
      `implementCommand expected a command specification, received ${specification.kind}.`,
    )
  return createCommandSpec(
    specification.name,
    specification.description,
    freezeScenarios(specification.scenarios),
  )
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
    specificationDigest: specificationDigest(
      'command',
      name,
      description,
      scenarios,
    ),
  })

  return Object.freeze({
    ...specification,
    inputSchema: (schema?: StandardSchemaV1) => ({
      store: <TStore extends StoreBinding>(
        store: TStore,
        options?: SliceStoreOptions,
      ) =>
        createCommandApplyStep(
          specification,
          schema,
          store,
          options?.eager ?? false,
          Object.freeze([]),
        ),
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
  TStore extends StoreBinding,
>(
  specification: Specification<'command', TName, TScenarios>,
  inputSchema: StandardSchemaV1<TInput, TCommand> | undefined,
  store: TStore,
  eager: boolean,
  apply: readonly ApplyRegistration<TWriteState>[],
): CommandApplyStep<
  TName,
  TInput,
  TCommand,
  TWriteState,
  TReadState,
  TScenarios,
  TStore
> {
  return Object.freeze({
    apply: <TDefinition extends ApplyEventDefinition>(
      definition: TDefinition,
      handle: (
        event: EventForDefinition<TDefinition>,
        state: TWriteState,
      ) => Promise<void>,
    ) =>
      createCommandApplyStep<
        TName,
        TInput,
        TCommand,
        TWriteState,
        TReadState,
        TScenarios,
        TStore
      >(specification, inputSchema, store, eager, [
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
        eager,
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

export function implementQuery(input: unknown): QuerySliceSpec<string> {
  const specification = loadSpecification(input)
  if (specification.kind !== 'query')
    throw new Error(
      `implementQuery expected a query specification, received ${specification.kind}.`,
    )
  return createQuerySpec(
    specification.name,
    specification.description,
    freezeScenarios(specification.scenarios),
  )
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
    specificationDigest: specificationDigest(
      'query',
      name,
      description,
      scenarios,
    ),
  })

  return Object.freeze({
    ...specification,
    inputSchema: (inputSchema?: StandardSchemaV1) => ({
      outputSchema: (outputSchema?: StandardSchemaV1) => ({
        store: <TStore extends StoreBinding>(
          store: TStore,
          options?: SliceStoreOptions,
        ) =>
          createQueryApplyStep(
            specification,
            inputSchema,
            outputSchema,
            store,
            options?.eager ?? false,
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
  TStore extends StoreBinding,
>(
  specification: Specification<'query', TName, TScenarios>,
  inputSchema: StandardSchemaV1<TInput, TQuery> | undefined,
  outputSchema: StandardSchemaV1<TResult, TOutput> | undefined,
  store: TStore,
  eager: boolean,
  apply: readonly ApplyRegistration<TWriteState>[],
): QueryApplyStep<
  TName,
  TInput,
  TQuery,
  TResult,
  TOutput,
  TWriteState,
  TReadState,
  TScenarios,
  TStore
> {
  return Object.freeze({
    apply: <TDefinition extends ApplyEventDefinition>(
      definition: TDefinition,
      handle: (
        event: EventForDefinition<TDefinition>,
        state: TWriteState,
      ) => Promise<void>,
    ) =>
      createQueryApplyStep<
        TName,
        TInput,
        TQuery,
        TResult,
        TOutput,
        TWriteState,
        TReadState,
        TScenarios,
        TStore
      >(specification, inputSchema, outputSchema, store, eager, [
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
        eager,
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

export function implementReaction(input: unknown): ReactionSliceSpec<string> {
  const specification = loadSpecification(input)
  if (specification.kind !== 'reaction')
    throw new Error(
      `implementReaction expected a reaction specification, received ${specification.kind}.`,
    )
  return createReactionSpec(
    specification.name,
    specification.description,
    freezeScenarios(specification.scenarios),
  )
}

function loadSpecification(input: unknown) {
  if (typeof input === 'string') return parseSpecificationJson(input)
  if (input instanceof Uint8Array)
    return parseSpecificationJson(new TextDecoder().decode(input))
  return parseSpecification(input)
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
    specificationDigest: specificationDigest(
      'reaction',
      name,
      description,
      scenarios,
    ),
  })

  return Object.freeze({
    ...specification,
    outputSchema: (outputSchema?: StandardSchemaV1) => {
      const storeStep = (plugin?: ReactionPlugin) => ({
        store: <TStore extends StoreBinding>(
          store: TStore,
          options?: SliceStoreOptions,
        ) =>
          createReactionApplyStep(
            specification,
            outputSchema,
            plugin,
            store,
            options?.eager ?? false,
            Object.freeze([]),
          ),
      })
      return {
        ...storeStep(),
        plugin: (plugin: ReactionPlugin) => storeStep(plugin),
      }
    },
  }) as ReactionSliceSpec<TName, TScenarios>
}

function specificationDigest(
  kind: 'command' | 'query' | 'reaction',
  name: string,
  description: string,
  scenarios: readonly SliceScenario[],
): SpecificationDigest {
  try {
    return digestSpecification({
      $schema: SPECTER_SPECIFICATION_SCHEMA,
      formatVersion: SPECTER_SPECIFICATION_FORMAT_VERSION,
      kind,
      name,
      description,
      scenarios,
    })
  } catch {
    // Existing TypeScript builders still allow conformance tests to construct
    // invalid drafts. The runtime rejects those before it can emit a span.
    return 'sha256:unavailable'
  }
}

function createReactionApplyStep<
  TName extends string,
  TResult,
  TOutput,
  TWriteState,
  TReadState,
  TScenarios extends NonEmptyScenarios<ReactionScenario>,
  TStore extends StoreBinding,
>(
  specification: Specification<'reaction', TName, TScenarios>,
  outputSchema: StandardSchemaV1<TResult, TOutput> | undefined,
  plugin: ReactionPlugin<TOutput> | undefined,
  store: TStore,
  eager: boolean,
  apply: readonly ApplyRegistration<TWriteState>[],
): ReactionApplyStep<
  TName,
  TResult,
  TOutput,
  TWriteState,
  TReadState,
  TScenarios,
  TStore
> {
  return Object.freeze({
    apply: <TDefinition extends ApplyEventDefinition>(
      definition: TDefinition,
      handle: (
        event: EventForDefinition<TDefinition>,
        state: TWriteState,
      ) => Promise<void>,
    ) =>
      createReactionApplyStep<
        TName,
        TResult,
        TOutput,
        TWriteState,
        TReadState,
        TScenarios,
        TStore
      >(specification, outputSchema, plugin, store, eager, [
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
        eager,
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
