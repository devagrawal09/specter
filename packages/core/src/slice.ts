import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'
import type { Effect } from 'effect'
import type * as SqlClient from '@effect/sql/SqlClient'
import type * as Schema from 'effect/Schema'
import type { Component } from 'solid-js'

import type { Event, EventDefinition, EventDraft } from './event'
import type { EventLogService, SliceStores } from './services'

type AnySchema = Schema.Schema.AnyNoContext
type SchemaType<TSchema extends AnySchema> = Schema.Schema.Type<TSchema>
type ApplyEventDefinition<
  TType extends string = string,
  TPayload = unknown,
> = Pick<EventDefinition<TType, TPayload>, 'type' | 'decode'>
export type SpecterAppServices =
  | EventLogService
  | SliceStores
  | SqlClient.SqlClient

export type RejectedCommand = {
  readonly reason: string
}

export type CommandEnvelope<
  TName extends string = string,
  TPayload = unknown,
> = {
  type: TName
  payload: TPayload
}

type EventType<TEventDefinition> = TEventDefinition extends {
  type: infer TType extends string
}
  ? TType
  : never

type EventPayloadForType<TEventDefinition, TType extends string> =
  TEventDefinition extends ApplyEventDefinition<TType, infer TPayload>
    ? TPayload
    : never

type EventForType<
  TEventDefinitions extends readonly ApplyEventDefinition[],
  TType extends string,
> = Event<TType, EventPayloadForType<TEventDefinitions[number], TType>>

type ApplyHandler<TEvent extends Event> = {
  bivarianceHack(
    event: TEvent,
    db: SqliteRemoteDatabase,
  ): Effect.Effect<void, unknown, never>
}['bivarianceHack']

export type ApplyHandlers<
  TEventDefinitions extends
    readonly ApplyEventDefinition[] = readonly ApplyEventDefinition[],
> = Partial<{
  [TType in EventType<TEventDefinitions[number]>]: ApplyHandler<
    EventForType<TEventDefinitions, TType>
  >
}>

export function defineApplyHandlers<
  const TEventDefinitions extends readonly ApplyEventDefinition[],
>(
  _eventDefinitions: TEventDefinitions,
  apply: ApplyHandlers<TEventDefinitions>,
): ApplyHandlers<TEventDefinitions> {
  return apply
}

type AnyApplyHandlers = ApplyHandlers<readonly ApplyEventDefinition[]>

export type CommandSlice<
  TName extends string = string,
  TSchema extends AnySchema = AnySchema,
> = {
  kind: 'command'
  name: TName
  schema: TSchema
  apply: AnyApplyHandlers
  scenarios?: readonly unknown[]
  handle: (
    db: SqliteRemoteDatabase,
    command: SchemaType<TSchema>,
  ) => Effect.Effect<EventDraft[], unknown, never>
}

export type QuerySlice<
  TName extends string = string,
  TSchema extends AnySchema = AnySchema,
  TResult = unknown,
> = {
  kind: 'query'
  name: TName
  schema: TSchema
  apply: AnyApplyHandlers
  scenarios?: readonly unknown[]
  handle: (
    db: SqliteRemoteDatabase,
    query: SchemaType<TSchema>,
  ) => Effect.Effect<TResult, unknown, never>
}

export type ViewQueryRef<TResult = unknown, TName extends string = string> = {
  name: TName
  result?: TResult
  input?: unknown
}

export type ViewCommandRef<
  TPayload = unknown,
  TName extends string = string,
> = {
  name: TName
  payload?: TPayload
}

export type QueryRef<TRegistration> =
  TRegistration extends QuerySlice<infer TName, infer TSchema, infer TResult>
    ? ViewQueryRef<TResult, TName> & { input?: SchemaType<TSchema> }
    : never

export type CommandRef<TRegistration> =
  TRegistration extends CommandSlice<infer TName, infer TSchema>
    ? ViewCommandRef<SchemaType<TSchema>, TName>
    : never

type ViewQueryResult<TRegistration> =
  TRegistration extends ViewQueryRef<infer TResult> ? TResult : never

type ViewQueryInput<TRegistration> = TRegistration extends {
  input?: infer TInput
}
  ? TInput
  : never

type CommandPayload<TRegistration> =
  TRegistration extends ViewCommandRef<infer TPayload> ? TPayload : never

export type ViewProps<
  TQueries extends Record<string, ViewQueryRef>,
  TTriggers extends Record<string, ViewCommandRef>,
> = {
  [TKey in keyof TQueries]: (
    input: ViewQueryInput<TQueries[TKey]>,
  ) => Effect.Effect<ViewQueryResult<TQueries[TKey]>, unknown>
} & {
  [TKey in keyof TTriggers]: (
    input: CommandPayload<TTriggers[TKey]>,
  ) => Effect.Effect<void, unknown>
}

export type ViewComponent<TProps extends Record<string, unknown>> = {
  bivarianceHack(props: TProps): ReturnType<Component<TProps>>
}['bivarianceHack']

export type ViewRegistration<
  TName extends string = string,
  TQueries extends Record<string, ViewQueryRef> = Record<string, ViewQueryRef>,
  TTriggers extends Record<string, ViewCommandRef> = Record<
    string,
    ViewCommandRef
  >,
> = ViewComponent<Record<string, never>> & {
  kind: 'view'
  name: TName
  queries: TQueries
  triggers: TTriggers
  component: ViewComponent<ViewProps<TQueries, TTriggers>>
}

export type CommandDispatch = (
  command: CommandEnvelope,
) => Effect.Effect<void, unknown, SpecterAppServices>

export type ReactionExec = (
  reaction: unknown,
) => Effect.Effect<unknown, unknown, SpecterAppServices>

export type ReactionPlugin = (
  command: CommandDispatch,
) => Effect.Effect<ReactionExec, unknown, SpecterAppServices>

export type ReactionSlice<
  TName extends string = string,
  TPayload = CommandEnvelope,
> = {
  kind: 'reaction'
  name: TName
  apply: AnyApplyHandlers
  plugin?: ReactionPlugin
  scenarios?: readonly unknown[]
  handle: (
    db: SqliteRemoteDatabase,
  ) => Effect.Effect<TPayload | undefined, unknown, never>
}

export type SliceRegistration =
  | CommandSlice
  | QuerySlice
  | ReactionSlice<string, unknown>
