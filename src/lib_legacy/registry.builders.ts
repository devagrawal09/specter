import type { Component } from 'solid-js'
import type { z } from 'zod'

import type { StoreTx } from '.'
import type { Event } from '../features/events'

export type SliceOptions = {
  json?: boolean
  eager?: boolean
}

export type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue }

export type JsonReadStore = {
  get: <TValue>(key: string) => TValue | undefined
}

export type JsonWriteStore = JsonReadStore & {
  set: (key: string, value: unknown) => void
  patch: <TValue extends Record<string, unknown>>(
    key: string,
    value: Partial<TValue>,
  ) => void
  delete: (key: string) => void
}

export type CommandEnvelope<
  TType extends string = string,
  TPayload = unknown,
> = {
  type: TType
  payload: TPayload
}

export type CommandScenario<TPayload = unknown> = {
  given: readonly Event[]
  when: TPayload
  expect: readonly Event[]
}

export type ApplyHandlers = {
  [TType in Event['type']]?: (
    event: Extract<Event, { type: TType }>,
    tx: StoreTx,
  ) => void
}

export type JsonApplyHandlers = {
  [TType in Event['type']]?: (
    event: Extract<Event, { type: TType }>,
    store: JsonWriteStore,
  ) => void
}

export type CommandRegistration<
  TType extends string = string,
  TSchema extends z.ZodType = z.ZodType,
> = {
  kind: 'command'
  json?: false
  eager?: boolean
  type: TType
  schema: TSchema
  apply?: ApplyHandlers
  decide: (command: z.infer<TSchema>, tx: StoreTx) => Event[]
  scenarios?: readonly CommandScenario<z.infer<TSchema>>[]
}

export type JsonCommandRegistration<
  TType extends string = string,
  TSchema extends z.ZodType = z.ZodType,
> = {
  kind: 'command'
  json: true
  eager?: boolean
  type: TType
  schema: TSchema
  apply?: JsonApplyHandlers
  decide: (command: z.infer<TSchema>, store: JsonReadStore) => Event[]
  scenarios?: readonly CommandScenario<z.infer<TSchema>>[]
}

export type AnyCommandRegistration =
  | CommandRegistration
  | JsonCommandRegistration

export type ProjectionScenario<TWhen = unknown, TExpect = unknown> = {
  given: readonly Event[]
  when: TWhen
  expect: TExpect
}

export type ProjectionRegistration<
  TName extends string = string,
  TSchema extends z.ZodType = z.ZodType,
  TState = unknown,
> = {
  kind: 'projection'
  json?: false
  eager?: boolean
  name: TName
  schema: TSchema
  apply: ApplyHandlers
  state: TState
  query: (tx: StoreTx, input: z.infer<TSchema>) => TState
  scenarios?: readonly ProjectionScenario<z.infer<TSchema>, TState>[]
}

export type JsonProjectionRegistration<
  TName extends string = string,
  TSchema extends z.ZodType = z.ZodType,
  TState = unknown,
> = {
  kind: 'projection'
  json: true
  eager?: boolean
  name: TName
  schema: TSchema
  apply: JsonApplyHandlers
  state: TState
  query: (store: JsonReadStore, input: z.infer<TSchema>) => TState
  scenarios?: readonly ProjectionScenario<z.infer<TSchema>, TState>[]
}

export type AnyProjectionRegistration =
  | ProjectionRegistration<string, z.ZodType>
  | JsonProjectionRegistration<string, z.ZodType>

export type ReactionScenario = {
  given: readonly Event[]
  when: Event
  expect: readonly CommandEnvelope[]
}

export type ReactionRegistration<TName extends string = string> = {
  kind: 'reaction'
  json?: false
  eager?: boolean
  name: TName
  apply?: ApplyHandlers
  react: (tx: StoreTx) => CommandEnvelope[]
  scenarios?: readonly ReactionScenario[]
}

export type JsonReactionRegistration<TName extends string = string> = {
  kind: 'reaction'
  json: true
  eager?: boolean
  name: TName
  apply?: JsonApplyHandlers
  react: (store: JsonReadStore) => CommandEnvelope[]
  scenarios?: readonly ReactionScenario[]
}

export type AnyReactionRegistration =
  | ReactionRegistration
  | JsonReactionRegistration

export type SliceRegistration =
  | AnyCommandRegistration
  | AnyProjectionRegistration
  | AnyReactionRegistration

type ProjectionQueryResult<TRegistration> =
  TRegistration extends ProjectionRegistration<string, z.ZodType, infer TState>
    ? TState
    : TRegistration extends JsonProjectionRegistration<
          string,
          z.ZodType,
          infer TState
        >
      ? TState
      : never

type CommandPayload<TRegistration> =
  TRegistration extends AnyCommandRegistration
    ? TRegistration extends { schema: infer TSchema extends z.ZodType }
      ? z.infer<TSchema>
      : never
    : never

type ViewScenarioGiven<
  TQueries extends Record<string, AnyProjectionRegistration>,
> = {
  [TKey in keyof TQueries]: ProjectionQueryResult<TQueries[TKey]>
}

export type ViewScenario<TGiven = unknown> = {
  name?: string
  given: TGiven
  when?: unknown
  expect?: unknown
}

export type ViewProps<
  TQueries extends Record<string, AnyProjectionRegistration>,
  TTriggers extends Record<string, AnyCommandRegistration>,
> = {
  [TKey in keyof TQueries]: ProjectionQueryResult<TQueries[TKey]>
} & {
  [TKey in keyof TTriggers]: (
    input: CommandPayload<TTriggers[TKey]>,
  ) => Promise<void>
}

export type ViewRegistration<
  TName extends string = string,
  TQueries extends Record<string, AnyProjectionRegistration> = Record<
    string,
    AnyProjectionRegistration
  >,
  TTriggers extends Record<string, AnyCommandRegistration> = Record<
    string,
    AnyCommandRegistration
  >,
> = {
  kind: 'view'
  name: TName
  queries: TQueries
  triggers: TTriggers
  scenarios: readonly ViewScenario<ViewScenarioGiven<TQueries>>[]
  component: Component<never>
}

export type CommandSliceSchemaStep<
  TType extends string,
  TJson extends boolean,
> = {
  schema: <TSchema extends z.ZodType>(
    schema: TSchema,
  ) => CommandSliceStep<TType, TSchema, TJson>
}

export type CommandSliceStep<
  TType extends string,
  TSchema extends z.ZodType,
  TJson extends boolean,
> = {
  decide: (
    decide: TJson extends true
      ? (command: z.infer<TSchema>, store: JsonReadStore) => Event[]
      : (command: z.infer<TSchema>, tx: StoreTx) => Event[],
  ) => TJson extends true
    ? JsonCommandRegistration<TType, TSchema>
    : CommandRegistration<TType, TSchema>
  apply: (
    apply: TJson extends true ? JsonApplyHandlers : ApplyHandlers,
  ) => CommandSliceApplyStep<TType, TSchema, TJson>
  scenarios: (
    ...scenarios: readonly CommandScenario<z.infer<TSchema>>[]
  ) => CommandSliceScenarioStep<TType, TSchema, TJson>
}

export type CommandSliceApplyStep<
  TType extends string,
  TSchema extends z.ZodType,
  TJson extends boolean,
> = {
  decide: CommandSliceStep<TType, TSchema, TJson>['decide']
  scenarios: CommandSliceStep<TType, TSchema, TJson>['scenarios']
}

export type CommandSliceScenarioStep<
  TType extends string,
  TSchema extends z.ZodType,
  TJson extends boolean,
> = {
  decide: CommandSliceStep<TType, TSchema, TJson>['decide']
  apply: CommandSliceStep<TType, TSchema, TJson>['apply']
}

export type ProjectionSliceSchemaStep<
  TName extends string,
  TJson extends boolean,
> = {
  schema: <TSchema extends z.ZodType>(
    schema: TSchema,
  ) => ProjectionSliceApplyStep<TName, TSchema, TJson>
}

export type ProjectionSliceApplyStep<
  TName extends string,
  TSchema extends z.ZodType,
  TJson extends boolean,
> = {
  apply: (
    apply: TJson extends true ? JsonApplyHandlers : ApplyHandlers,
  ) => ProjectionSliceQueryStep<TName, TSchema, TJson>
}

export type ProjectionSliceQueryStep<
  TName extends string,
  TSchema extends z.ZodType,
  TJson extends boolean,
> = {
  query: <TState>(
    query: TJson extends true
      ? (store: JsonReadStore, input: z.infer<TSchema>) => TState
      : (tx: StoreTx, input: z.infer<TSchema>) => TState,
  ) => TJson extends true
    ? JsonProjectionRegistration<TName, TSchema, TState>
    : ProjectionRegistration<TName, TSchema, TState>
  state: <TState>(
    state: TState,
  ) => ProjectionSliceStateStep<TName, TSchema, TState, TJson>
  scenarios: (
    ...scenarios: readonly ProjectionScenario<z.infer<TSchema>>[]
  ) => ProjectionSliceScenarioStep<TName, TSchema, TJson>
}

export type ProjectionSliceScenarioStep<
  TName extends string,
  TSchema extends z.ZodType,
  TJson extends boolean,
> = {
  query: ProjectionSliceQueryStep<TName, TSchema, TJson>['query']
  state: ProjectionSliceQueryStep<TName, TSchema, TJson>['state']
}

export type ProjectionSliceStateStep<
  TName extends string,
  TSchema extends z.ZodType,
  TState,
  TJson extends boolean,
> = {
  query: (
    query: TJson extends true
      ? (store: JsonReadStore, input: z.infer<TSchema>) => TState
      : (tx: StoreTx, input: z.infer<TSchema>) => TState,
  ) => TJson extends true
    ? JsonProjectionRegistration<TName, TSchema, TState>
    : ProjectionRegistration<TName, TSchema, TState>
  scenarios: (
    ...scenarios: readonly ProjectionScenario<z.infer<TSchema>, TState>[]
  ) => ProjectionSliceStateScenarioStep<TName, TSchema, TState, TJson>
}

export type ProjectionSliceStateScenarioStep<
  TName extends string,
  TSchema extends z.ZodType,
  TState,
  TJson extends boolean,
> = {
  query: ProjectionSliceStateStep<TName, TSchema, TState, TJson>['query']
}

export type ReactionSliceReactStep<
  TName extends string,
  TJson extends boolean,
> = {
  react: (
    react: TJson extends true
      ? (store: JsonReadStore) => CommandEnvelope[]
      : (tx: StoreTx) => CommandEnvelope[],
  ) => TJson extends true
    ? JsonReactionRegistration<TName>
    : ReactionRegistration<TName>
  apply: (
    apply: TJson extends true ? JsonApplyHandlers : ApplyHandlers,
  ) => ReactionSliceApplyStep<TName, TJson>
  scenarios: (
    ...scenarios: readonly ReactionScenario[]
  ) => ReactionSliceScenarioStep<TName, TJson>
}

export type ReactionSliceApplyStep<
  TName extends string,
  TJson extends boolean,
> = {
  react: ReactionSliceReactStep<TName, TJson>['react']
  scenarios: ReactionSliceReactStep<TName, TJson>['scenarios']
}

export type ReactionSliceScenarioStep<
  TName extends string,
  TJson extends boolean,
> = {
  react: ReactionSliceReactStep<TName, TJson>['react']
  apply: ReactionSliceReactStep<TName, TJson>['apply']
}

export type ViewSliceQueriesStep<TName extends string> = {
  queries: <TQueries extends Record<string, AnyProjectionRegistration>>(
    queries: TQueries,
  ) => ViewSliceTriggersStep<TName, TQueries>
}

export type ViewSliceTriggersStep<
  TName extends string,
  TQueries extends Record<string, AnyProjectionRegistration>,
> = {
  triggers: <TTriggers extends Record<string, AnyCommandRegistration>>(
    triggers: TTriggers,
  ) => ViewSliceScenariosStep<TName, TQueries, TTriggers>
}

export type ViewSliceScenariosStep<
  TName extends string,
  TQueries extends Record<string, AnyProjectionRegistration>,
  TTriggers extends Record<string, AnyCommandRegistration>,
> = {
  scenarios: (
    scenarios: readonly ViewScenario<ViewScenarioGiven<TQueries>>[],
  ) => ViewSliceComponentStep<TName, TQueries, TTriggers>
}

export type ViewSliceComponentStep<
  TName extends string,
  TQueries extends Record<string, AnyProjectionRegistration>,
  TTriggers extends Record<string, AnyCommandRegistration>,
> = {
  component: (
    component: Component<ViewProps<TQueries, TTriggers>>,
  ) => ViewRegistration<TName, TQueries, TTriggers>
}

export function createCommandSpec<const TType extends string>(
  type: TType,
): CommandSliceSchemaStep<TType, false>
export function createCommandSpec<const TType extends string>(
  type: TType,
  options: { json: true },
): CommandSliceSchemaStep<TType, true>
export function createCommandSpec<const TType extends string>(
  type: TType,
  options: SliceOptions = {},
  // biome-ignore lint/suspicious/noExplicitAny: overload implementation bridges durable/json builders
): any {
  return {
    schema: (schema: z.ZodType) => {
      const createRegistration = (
        decide: unknown,
        apply?: unknown,
        scenarios?: unknown,
      ) => ({
        kind: 'command',
        json: options.json ? true : undefined,
        eager: options.eager,
        type,
        schema,
        apply,
        decide,
        scenarios,
      })

      return {
        decide: (decide: unknown) => createRegistration(decide),
        apply: (apply: unknown) => ({
          decide: (decide: unknown) => createRegistration(decide, apply),
          scenarios: (...scenarios: unknown[]) => ({
            decide: (decide: unknown) =>
              createRegistration(decide, apply, scenarios),
          }),
        }),
        scenarios: (...scenarios: unknown[]) => ({
          decide: (decide: unknown) =>
            createRegistration(decide, undefined, scenarios),
          apply: (apply: unknown) => ({
            decide: (decide: unknown) =>
              createRegistration(decide, apply, scenarios),
          }),
        }),
      }
    },
  }
}

export function createProjectionSpec<const TName extends string>(
  name: TName,
): ProjectionSliceSchemaStep<TName, false>
export function createProjectionSpec<const TName extends string>(
  name: TName,
  options: { json: true },
): ProjectionSliceSchemaStep<TName, true>
export function createProjectionSpec<const TName extends string>(
  name: TName,
  options: SliceOptions = {},
  // biome-ignore lint/suspicious/noExplicitAny: overload implementation bridges durable/json builders
): any {
  return {
    schema: (schema: z.ZodType) => ({
      apply: (apply: unknown) => {
        const createRegistration = (
          query: unknown,
          state?: unknown,
          scenarios?: unknown,
        ) => ({
          kind: 'projection',
          json: options.json ? true : undefined,
          eager: options.eager,
          name,
          schema,
          apply,
          state,
          query,
          scenarios,
        })

        const createStateStep = (state: unknown, scenarios?: unknown) => ({
          query: (query: unknown) =>
            createRegistration(query, state, scenarios),
        })

        return {
          query: (query: unknown) => createRegistration(query),
          state: (state: unknown) => ({
            query: (query: unknown) => createRegistration(query, state),
            scenarios: (...scenarios: unknown[]) =>
              createStateStep(state, scenarios),
          }),
          scenarios: (...scenarios: unknown[]) => ({
            query: (query: unknown) =>
              createRegistration(query, undefined, scenarios),
            state: (state: unknown) => createStateStep(state, scenarios),
          }),
        }
      },
    }),
  }
}

export function createReactionSpec<const TName extends string>(
  name: TName,
): ReactionSliceReactStep<TName, false>
export function createReactionSpec<const TName extends string>(
  name: TName,
  options: { json: true },
): ReactionSliceReactStep<TName, true>
export function createReactionSpec<const TName extends string>(
  name: TName,
  options: SliceOptions = {},
  // biome-ignore lint/suspicious/noExplicitAny: overload implementation bridges durable/json builders
): any {
  const createRegistration = (
    react: unknown,
    apply?: unknown,
    scenarios?: unknown,
  ) => ({
    kind: 'reaction',
    json: options.json ? true : undefined,
    eager: options.eager,
    name,
    apply,
    react,
    scenarios,
  })

  return {
    react: (react: unknown) => createRegistration(react),
    apply: (apply: unknown) => ({
      react: (react: unknown) => createRegistration(react, apply),
      scenarios: (...scenarios: unknown[]) => ({
        react: (react: unknown) => createRegistration(react, apply, scenarios),
      }),
    }),
    scenarios: (...scenarios: unknown[]) => ({
      react: (react: unknown) =>
        createRegistration(react, undefined, scenarios),
      apply: (apply: unknown) => ({
        react: (react: unknown) => createRegistration(react, apply, scenarios),
      }),
    }),
  }
}

export function createViewSpec<const TName extends string>(
  name: TName,
): ViewSliceQueriesStep<TName> {
  return {
    queries: (queries) => ({
      triggers: (triggers) => ({
        scenarios: (scenarios) => ({
          component: (component) => ({
            kind: 'view',
            name,
            queries,
            triggers,
            scenarios,
            component,
          }),
        }),
      }),
    }),
  }
}
