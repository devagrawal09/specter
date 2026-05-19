import type { Component } from 'solid-js'
import type { z } from 'zod'

import type { StoreTx } from './shared'
import type { Event } from './shared/events'

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

export type ProjectionUiAssertion = {
  visible?: readonly string[]
  hidden?: readonly string[]
  text?: Readonly<Record<string, string>>
  count?: Readonly<Record<string, number>>
}

export type ProjectionScenario<TWhen = unknown> = {
  given: readonly Event[]
  when: TWhen
  expect: ProjectionUiAssertion
}

export type ProjectionRegistration<
  TName extends string = string,
  TSchema extends z.ZodType = z.ZodType,
  TComponent extends Component = Component,
> = {
  kind: 'projection'
  name: TName
  schema: TSchema
  apply: ApplyHandlers
  component: TComponent
  scenarios?: readonly ProjectionScenario<z.infer<TSchema>>[]
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
  | ProjectionRegistration<string, z.ZodType, Component>
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
  apply: (apply: ApplyHandlers) => ProjectionSliceComponentStep<TName, TSchema>
}

export type ProjectionSliceComponentStep<
  TName extends string,
  TSchema extends z.ZodType,
> = {
  component: <TComponent extends Component>(
    component: TComponent,
  ) => ProjectionRegistration<TName, TSchema, TComponent>
  scenarios: (
    ...scenarios: readonly ProjectionScenario<z.infer<TSchema>>[]
  ) => ProjectionSliceScenarioStep<TName, TSchema>
}

export type ProjectionSliceScenarioStep<
  TName extends string,
  TSchema extends z.ZodType,
> = {
  component: <TComponent extends Component>(
    component: TComponent,
  ) => ProjectionRegistration<TName, TSchema, TComponent>
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
        const createRegistration = <TComponent extends Component>(
          component: TComponent,
          scenarios?: readonly ProjectionScenario<z.infer<typeof schema>>[],
        ): ProjectionRegistration<TName, typeof schema, TComponent> => ({
          kind: 'projection',
          name,
          schema,
          apply,
          component,
          scenarios,
        })

        return {
          component: (component) => createRegistration(component),
          scenarios: (...scenarios) => ({
            component: (component) => createRegistration(component, scenarios),
          }),
        }
      },
    }),
  }
}
