import type { Component } from 'solid-js'
import type { z } from 'zod'

import type { StoredTodoEvent, Event, StoreTx } from './shared'

export type CommandRegistration<
  TType extends string = string,
  TSchema extends z.ZodType = z.ZodType,
> = {
  kind: 'command'
  type: TType
  schema: TSchema
  decide: (tx: StoreTx, command: z.infer<TSchema>) => Event[]
  applyEvents?: (tx: StoreTx, events: StoredTodoEvent[]) => void
}

export type ProjectionRegistration<
  TName extends string = string,
  TSchema extends z.ZodType = z.ZodType,
  TComponent extends Component = Component,
> = {
  kind: 'projection'
  name: TName
  schema: TSchema
  applyEvents: (tx: StoreTx, events: StoredTodoEvent[]) => void
  component: TComponent
}

export type SliceRegistration =
  | CommandRegistration
  | ProjectionRegistration<string, z.ZodType, Component>

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
    decide: (tx: StoreTx, command: z.infer<TSchema>) => Event[],
  ) => CommandRegistration<TType, TSchema>
  applyEvents: (
    applyEvents: (tx: StoreTx, events: StoredTodoEvent[]) => void,
  ) => CommandSliceApplyEventsStep<TType, TSchema>
}

export type CommandSliceApplyEventsStep<
  TType extends string,
  TSchema extends z.ZodType,
> = {
  decide: (
    decide: (tx: StoreTx, command: z.infer<TSchema>) => Event[],
  ) => CommandRegistration<TType, TSchema>
}

export type ProjectionSliceSchemaStep<TName extends string> = {
  schema: <TSchema extends z.ZodType>(
    schema: TSchema,
  ) => ProjectionSliceApplyEventsStep<TName, TSchema>
}

export type ProjectionSliceApplyEventsStep<
  TName extends string,
  TSchema extends z.ZodType,
> = {
  applyEvents: (
    applyEvents: (tx: StoreTx, events: StoredTodoEvent[]) => void,
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
      applyEvents: (applyEvents) => ({
        decide: (decide) => ({
          kind: 'command',
          type,
          schema,
          applyEvents,
          decide,
        }),
      }),
    }),
  }
}

export function createProjectionSlice<const TName extends string>(
  name: TName,
): ProjectionSliceSchemaStep<TName> {
  return {
    schema: (schema) => ({
      applyEvents: (applyEvents) => ({
        component: (component) => ({
          kind: 'projection',
          name,
          schema,
          applyEvents,
          component,
        }),
      }),
    }),
  }
}
