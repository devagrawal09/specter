import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'
import type { Effect } from 'effect'
import type * as SqlClient from '@effect/sql/SqlClient'
import type * as Schema from 'effect/Schema'
import type { Component } from 'solid-js'

import type { Event, PersistedEvent } from './event'
import type { EventLogService, SliceStores } from './services'

type AnySchema = Schema.Schema.AnyNoContext
type SchemaType<TSchema extends AnySchema> = Schema.Schema.Type<TSchema>
export type RegistryServices =
  | EventLogService
  | SliceStores
  | SqlClient.SqlClient

export type CommandEnvelope<
  TName extends string = string,
  TPayload = unknown,
> = {
  type: TName
  payload: TPayload
}

export type ApplyHandlers = Record<
  string,
  (
    event: Event,
    db: SqliteRemoteDatabase,
  ) => Effect.Effect<void, unknown, never>
>

export type CommandSlice<
  TName extends string = string,
  TSchema extends AnySchema = AnySchema,
> = {
  kind: 'command'
  name: TName
  schema: TSchema
  apply: ApplyHandlers
  scenarios?: readonly unknown[]
  handle: (
    db: SqliteRemoteDatabase,
    command: SchemaType<TSchema>,
  ) => Effect.Effect<Event[], unknown, never>
}

export type ProjectionSlice<
  TName extends string = string,
  TSchema extends AnySchema = AnySchema,
  TResult = unknown,
> = {
  kind: 'projection'
  name: TName
  schema: TSchema
  apply: ApplyHandlers
  scenarios?: readonly unknown[]
  handle: (
    db: SqliteRemoteDatabase,
    query: SchemaType<TSchema>,
  ) => Effect.Effect<TResult, unknown, never>
}

export type ViewProjectionRef<
  TResult = unknown,
  TName extends string = string,
> = {
  name: TName
  result?: TResult
}

export type ViewCommandRef<
  TPayload = unknown,
  TName extends string = string,
> = {
  name: TName
  payload?: TPayload
}

export type ProjectionRef<TRegistration> =
  TRegistration extends ProjectionSlice<infer TName, AnySchema, infer TResult>
    ? ViewProjectionRef<TResult, TName>
    : never

export type CommandRef<TRegistration> =
  TRegistration extends CommandSlice<infer TName, infer TSchema>
    ? ViewCommandRef<SchemaType<TSchema>, TName>
    : never

type ProjectionQueryResult<TRegistration> =
  TRegistration extends ViewProjectionRef<infer TResult> ? TResult : never

type CommandPayload<TRegistration> =
  TRegistration extends ViewCommandRef<infer TPayload> ? TPayload : never

type ViewScenarioGiven<TQueries extends Record<string, ViewProjectionRef>> = {
  [TKey in keyof TQueries]: ProjectionQueryResult<TQueries[TKey]>
}

export type ViewScenario<TGiven = unknown> = {
  name?: string
  given: TGiven
  when?: unknown
  expect?: unknown
}

export type ViewProps<
  TQueries extends Record<string, ViewProjectionRef>,
  TTriggers extends Record<string, ViewCommandRef>,
> = {
  [TKey in keyof TQueries]: ProjectionQueryResult<TQueries[TKey]>
} & {
  [TKey in keyof TTriggers]: (
    input: CommandPayload<TTriggers[TKey]>,
  ) => Promise<void>
}

export type ViewComponent<TProps extends Record<string, unknown>> = {
  bivarianceHack(props: TProps): ReturnType<Component<TProps>>
}['bivarianceHack']

export type ViewRegistration<
  TName extends string = string,
  TQueries extends Record<string, ViewProjectionRef> = Record<
    string,
    ViewProjectionRef
  >,
  TTriggers extends Record<string, ViewCommandRef> = Record<
    string,
    ViewCommandRef
  >,
> = {
  kind: 'view'
  name: TName
  queries: TQueries
  triggers: TTriggers
  scenarios: readonly ViewScenario<ViewScenarioGiven<TQueries>>[]
  component: ViewComponent<ViewProps<TQueries, TTriggers>>
}

export type CommandDispatch = (
  command: CommandEnvelope,
) => Effect.Effect<PersistedEvent[], unknown, RegistryServices>

export type ReactionExec = (
  reaction: unknown,
) => Effect.Effect<unknown, unknown, RegistryServices>

export type ReactionPlugin = (
  command: CommandDispatch,
) => Effect.Effect<ReactionExec, unknown, RegistryServices>

export type ReactionSlice<
  TName extends string = string,
  TPayload = CommandEnvelope,
> = {
  kind: 'reaction'
  name: TName
  apply: ApplyHandlers
  plugin?: ReactionPlugin
  scenarios?: readonly unknown[]
  handle: (
    db: SqliteRemoteDatabase,
  ) => Effect.Effect<TPayload | undefined, unknown, never>
}

export type SliceRegistration =
  | CommandSlice
  | ProjectionSlice
  | ReactionSlice<string, unknown>
