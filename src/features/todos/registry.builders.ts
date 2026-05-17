import type { Component } from 'solid-js'
import type { z } from 'zod'

import type { Event, StoreTx } from './shared'

export type CommandEnvelope<
  TType extends string = string,
  TPayload = unknown,
> = {
  type: TType
  payload: TPayload
}

export type CommandRegistration<
  TType extends string = string,
  TSchema extends z.ZodType = z.ZodType,
> = {
  kind: 'command'
  type: TType
  schema: TSchema
  decide: (command: z.infer<TSchema>, tx: StoreTx) => Event[]
  apply?: (event: Event, tx: StoreTx) => void
}

export type ProjectionRegistration<
  TName extends string = string,
  TSchema extends z.ZodType = z.ZodType,
  TComponent extends Component = Component,
> = {
  kind: 'projection'
  name: TName
  schema: TSchema
  apply: (event: Event, tx: StoreTx) => void
  component: TComponent
}

export type ReactionRegistration<TName extends string = string> = {
  kind: 'reaction'
  name: TName
  apply?: (event: Event, tx: StoreTx) => void
  react: (event: Event, tx: StoreTx) => CommandEnvelope[]
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
  apply: (
    apply: (event: Event, tx: StoreTx) => void,
  ) => CommandSliceApplyStep<TType, TSchema>
}

export type CommandSliceApplyStep<
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
  apply: (
    apply: (event: Event, tx: StoreTx) => void,
  ) => ProjectionSliceComponentStep<TName, TSchema>
}

export type ProjectionSliceComponentStep<
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
  apply: (
    apply: (event: Event, tx: StoreTx) => void,
  ) => ReactionSliceApplyStep<TName>
}

export type ReactionSliceApplyStep<TName extends string> = {
  react: (
    react: (event: Event, tx: StoreTx) => CommandEnvelope[],
  ) => ReactionRegistration<TName>
}

export function createCommandSlice<const TType extends string>(
  type: TType,
): CommandSliceSchemaStep<TType> {
  return {
    schema: (schema) => ({
      decide: (decide) => ({
        kind: 'command',
        type,
        schema,
        decide,
      }),
      apply: (apply) => ({
        decide: (decide) => ({
          kind: 'command',
          type,
          schema,
          apply,
          decide,
        }),
      }),
    }),
  }
}

export function createReactionSlice<const TName extends string>(
  name: TName,
): ReactionSliceReactStep<TName> {
  return {
    react: (react) => ({
      kind: 'reaction',
      name,
      react,
    }),
    apply: (apply) => ({
      react: (react) => ({
        kind: 'reaction',
        name,
        apply,
        react,
      }),
    }),
  }
}

export function createProjectionSlice<const TName extends string>(
  name: TName,
): ProjectionSliceSchemaStep<TName> {
  return {
    schema: (schema) => ({
      apply: (apply) => ({
        component: (component) => ({
          kind: 'projection',
          name,
          schema,
          apply,
          component,
        }),
      }),
    }),
  }
}
