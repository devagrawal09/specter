import type { Component } from 'solid-js'
import type { z } from 'zod'

import type { StoreTx } from '.'
import type { Event } from '../features/events'

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

export type CommandRegistration<
  TType extends string = string,
  TSchema extends z.ZodType = z.ZodType,
> = {
  kind: 'command'
  type: TType
  schema: TSchema
  decide: (command: z.infer<TSchema>, tx: StoreTx) => Event[]
  apply?: ApplyHandlers
  scenarios?: readonly CommandScenario<z.infer<TSchema>>[]
}

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
  name: TName
  schema: TSchema
  apply: ApplyHandlers
  state: TState
  query: (tx: StoreTx, input: z.infer<TSchema>) => TState
  scenarios?: readonly ProjectionScenario<z.infer<TSchema>, TState>[]
}

type ViewScenarioGiven<
  TQueries extends Record<string, ProjectionRegistration>,
> = {
  [TKey in keyof TQueries]: ProjectionQueryResult<TQueries[TKey]>
}

export type ViewScenario<TGiven = unknown> = {
  name?: string
  given: TGiven
  when?: unknown
  expect?: unknown
}

type ProjectionQueryResult<TRegistration> =
  TRegistration extends ProjectionRegistration<string, z.ZodType, infer TState>
    ? TState
    : never

type CommandPayload<TRegistration> =
  TRegistration extends CommandRegistration<string, infer TSchema>
    ? z.infer<TSchema>
    : never

export type ViewProps<
  TQueries extends Record<string, ProjectionRegistration>,
  TTriggers extends Record<string, CommandRegistration>,
> = {
  [TKey in keyof TQueries]: ProjectionQueryResult<TQueries[TKey]>
} & {
  [TKey in keyof TTriggers]: (
    input: CommandPayload<TTriggers[TKey]>,
  ) => Promise<void>
}

export type ViewRegistration<
  TName extends string = string,
  TQueries extends Record<string, ProjectionRegistration> = Record<
    string,
    ProjectionRegistration
  >,
  TTriggers extends Record<string, CommandRegistration> = Record<
    string,
    CommandRegistration
  >,
> = {
  kind: 'view'
  name: TName
  queries: TQueries
  triggers: TTriggers
  scenarios: readonly ViewScenario<ViewScenarioGiven<TQueries>>[]
  component: Component<never>
}

export type ReactionScenario = {
  given: readonly Event[]
  when: Event
  expect: readonly CommandEnvelope[]
}

export type ReactionRegistration<TName extends string = string> = {
  kind: 'reaction'
  name: TName
  apply?: ApplyHandlers
  react: (event: Event, tx: StoreTx) => CommandEnvelope[]
  scenarios?: readonly ReactionScenario[]
}

export type SliceRegistration =
  | CommandRegistration
  | ProjectionRegistration<string, z.ZodType>
  | ReactionRegistration

export type CommandSliceSchemaStep<TType extends string> = {
  schema: <TSchema extends z.ZodType>(
    schema: TSchema,
  ) => CommandSliceDecideStep<TType, TSchema>
}

export type CommandSliceDecideStep<
  TType extends string,
  TSchema extends z.ZodType,
> = {
  decide: (
    decide: (command: z.infer<TSchema>, tx: StoreTx) => Event[],
  ) => CommandRegistration<TType, TSchema>
  apply: (apply: ApplyHandlers) => CommandSliceApplyStep<TType, TSchema>
  scenarios: (
    ...scenarios: readonly CommandScenario<z.infer<TSchema>>[]
  ) => CommandSliceScenarioStep<TType, TSchema>
}

export type CommandSliceApplyStep<
  TType extends string,
  TSchema extends z.ZodType,
> = {
  decide: (
    decide: (command: z.infer<TSchema>, tx: StoreTx) => Event[],
  ) => CommandRegistration<TType, TSchema>
  scenarios: (
    ...scenarios: readonly CommandScenario<z.infer<TSchema>>[]
  ) => CommandSliceApplyScenarioStep<TType, TSchema>
}

export type CommandSliceScenarioStep<
  TType extends string,
  TSchema extends z.ZodType,
> = {
  decide: (
    decide: (command: z.infer<TSchema>, tx: StoreTx) => Event[],
  ) => CommandRegistration<TType, TSchema>
  apply: (apply: ApplyHandlers) => CommandSliceApplyScenarioStep<TType, TSchema>
}

export type CommandSliceApplyScenarioStep<
  TType extends string,
  TSchema extends z.ZodType,
> = {
  decide: (
    decide: (command: z.infer<TSchema>, tx: StoreTx) => Event[],
  ) => CommandRegistration<TType, TSchema>
}

export type ProjectionSliceSchemaStep<TName extends string> = {
  schema: <TSchema extends z.ZodType>(
    schema: TSchema,
  ) => ProjectionSliceApplyStep<TName, TSchema>
}

export type ProjectionSliceApplyStep<
  TName extends string,
  TSchema extends z.ZodType,
> = {
  apply: (apply: ApplyHandlers) => ProjectionSliceQueryStep<TName, TSchema>
}

export type ProjectionSliceQueryStep<
  TName extends string,
  TSchema extends z.ZodType,
> = {
  query: <TState>(
    query: (tx: StoreTx, input: z.infer<TSchema>) => TState,
  ) => ProjectionRegistration<TName, TSchema, TState>
  state: <TState>(
    state: TState,
  ) => ProjectionSliceStateStep<TName, TSchema, TState>
  scenarios: (
    ...scenarios: readonly ProjectionScenario<z.infer<TSchema>>[]
  ) => ProjectionSliceScenarioStep<TName, TSchema>
}

export type ProjectionSliceScenarioStep<
  TName extends string,
  TSchema extends z.ZodType,
> = {
  query: <TState>(
    query: (tx: StoreTx, input: z.infer<TSchema>) => TState,
  ) => ProjectionRegistration<TName, TSchema, TState>
  state: <TState>(
    state: TState,
  ) => ProjectionSliceStateScenarioStep<TName, TSchema, TState>
}

export type ProjectionSliceStateStep<
  TName extends string,
  TSchema extends z.ZodType,
  TState,
> = {
  query: (
    query: (tx: StoreTx, input: z.infer<TSchema>) => TState,
  ) => ProjectionRegistration<TName, TSchema, TState>
  scenarios: (
    ...scenarios: readonly ProjectionScenario<z.infer<TSchema>, TState>[]
  ) => ProjectionSliceStateScenarioStep<TName, TSchema, TState>
}

export type ProjectionSliceStateScenarioStep<
  TName extends string,
  TSchema extends z.ZodType,
  TState,
> = {
  query: (
    query: (tx: StoreTx, input: z.infer<TSchema>) => TState,
  ) => ProjectionRegistration<TName, TSchema, TState>
}

export type ViewSliceQueriesStep<TName extends string> = {
  queries: <TQueries extends Record<string, ProjectionRegistration>>(
    queries: TQueries,
  ) => ViewSliceTriggersStep<TName, TQueries>
}

export type ViewSliceTriggersStep<
  TName extends string,
  TQueries extends Record<string, ProjectionRegistration>,
> = {
  triggers: <TTriggers extends Record<string, CommandRegistration>>(
    triggers: TTriggers,
  ) => ViewSliceScenariosStep<TName, TQueries, TTriggers>
}

export type ViewSliceScenariosStep<
  TName extends string,
  TQueries extends Record<string, ProjectionRegistration>,
  TTriggers extends Record<string, CommandRegistration>,
> = {
  scenarios: (
    scenarios: readonly ViewScenario<ViewScenarioGiven<TQueries>>[],
  ) => ViewSliceComponentStep<TName, TQueries, TTriggers>
}

export type ViewSliceComponentStep<
  TName extends string,
  TQueries extends Record<string, ProjectionRegistration>,
  TTriggers extends Record<string, CommandRegistration>,
> = {
  component: (
    component: Component<ViewProps<TQueries, TTriggers>>,
  ) => ViewRegistration<TName, TQueries, TTriggers>
}

export type ReactionSliceReactStep<TName extends string> = {
  react: (
    react: (event: Event, tx: StoreTx) => CommandEnvelope[],
  ) => ReactionRegistration<TName>
  apply: (apply: ApplyHandlers) => ReactionSliceApplyStep<TName>
  scenarios: (
    ...scenarios: readonly ReactionScenario[]
  ) => ReactionSliceScenarioStep<TName>
}

export type ReactionSliceApplyStep<TName extends string> = {
  react: (
    react: (event: Event, tx: StoreTx) => CommandEnvelope[],
  ) => ReactionRegistration<TName>
  scenarios: (
    ...scenarios: readonly ReactionScenario[]
  ) => ReactionSliceApplyScenarioStep<TName>
}

export type ReactionSliceScenarioStep<TName extends string> = {
  react: (
    react: (event: Event, tx: StoreTx) => CommandEnvelope[],
  ) => ReactionRegistration<TName>
  apply: (apply: ApplyHandlers) => ReactionSliceApplyScenarioStep<TName>
}

export type ReactionSliceApplyScenarioStep<TName extends string> = {
  react: (
    react: (event: Event, tx: StoreTx) => CommandEnvelope[],
  ) => ReactionRegistration<TName>
}

export function createCommandSpec<const TType extends string>(
  type: TType,
): CommandSliceSchemaStep<TType> {
  return {
    schema: (schema) => {
      const createRegistration = (
        decide: (command: z.infer<typeof schema>, tx: StoreTx) => Event[],
        apply?: ApplyHandlers,
        scenarios?: readonly CommandScenario<z.infer<typeof schema>>[],
      ): CommandRegistration<TType, typeof schema> => ({
        kind: 'command',
        type,
        schema,
        apply,
        decide,
        scenarios,
      })

      return {
        decide: (decide) => createRegistration(decide),
        apply: (apply) => ({
          decide: (decide) => createRegistration(decide, apply),
          scenarios: (...scenarios) => ({
            decide: (decide) => createRegistration(decide, apply, scenarios),
          }),
        }),
        scenarios: (...scenarios) => ({
          decide: (decide) => createRegistration(decide, undefined, scenarios),
          apply: (apply) => ({
            decide: (decide) => createRegistration(decide, apply, scenarios),
          }),
        }),
      }
    },
  }
}

export function createReactionSpec<const TName extends string>(
  name: TName,
): ReactionSliceReactStep<TName> {
  const createRegistration = (
    react: (event: Event, tx: StoreTx) => CommandEnvelope[],
    apply?: ApplyHandlers,
    scenarios?: readonly ReactionScenario[],
  ): ReactionRegistration<TName> => ({
    kind: 'reaction',
    name,
    apply,
    react,
    scenarios,
  })

  return {
    react: (react) => createRegistration(react),
    apply: (apply) => ({
      react: (react) => createRegistration(react, apply),
      scenarios: (...scenarios) => ({
        react: (react) => createRegistration(react, apply, scenarios),
      }),
    }),
    scenarios: (...scenarios) => ({
      react: (react) => createRegistration(react, undefined, scenarios),
      apply: (apply) => ({
        react: (react) => createRegistration(react, apply, scenarios),
      }),
    }),
  }
}

export function createProjectionSpec<const TName extends string>(
  name: TName,
): ProjectionSliceSchemaStep<TName> {
  return {
    schema: (schema) => ({
      apply: (apply) => {
        const createRegistration = <TState>(
          query: (tx: StoreTx, input: z.infer<typeof schema>) => TState,
          state: TState,
          scenarios?: readonly ProjectionScenario<
            z.infer<typeof schema>,
            TState
          >[],
        ): ProjectionRegistration<TName, typeof schema, TState> => ({
          kind: 'projection',
          name,
          schema,
          apply,
          state,
          query,
          scenarios,
        })

        const createStateStep = <TState>(
          state: TState,
          scenarios?: readonly ProjectionScenario<
            z.infer<typeof schema>,
            TState
          >[],
        ) => ({
          query: (
            query: (tx: StoreTx, input: z.infer<typeof schema>) => TState,
          ) => createRegistration(query, state, scenarios),
        })

        return {
          query: (query) => createRegistration(query, undefined as never),
          state: (state) => ({
            query: (query) => createRegistration(query, state),
            scenarios: (...scenarios) => createStateStep(state, scenarios),
          }),
          scenarios: (...scenarios) => ({
            query: (query) =>
              createRegistration(
                query,
                undefined as never,
                scenarios as readonly ProjectionScenario<
                  z.infer<typeof schema>,
                  never
                >[],
              ),
            state: (state) =>
              createStateStep(
                state,
                scenarios as readonly ProjectionScenario<
                  z.infer<typeof schema>,
                  typeof state
                >[],
              ),
          }),
        }
      },
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
