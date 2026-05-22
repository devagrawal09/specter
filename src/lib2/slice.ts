// biome-ignore-all lint/suspicious/noExplicitAny: slice callbacks can require arbitrary Effect services.
import type { z } from 'zod'
import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'
import type { Effect } from 'effect'

import type { Event, PersistedEvent } from './event'

export type CommandEnvelope<
  TName extends string = string,
  TPayload = unknown,
> = {
  type: TName
  payload: TPayload
}

export type ApplyHandlers = Record<
  string,
  (event: Event, db: SqliteRemoteDatabase) => Effect.Effect<void, unknown, any>
>

export type CommandSlice<
  TName extends string = string,
  TSchema extends z.ZodType = z.ZodType,
> = {
  kind: 'command'
  name: TName
  schema: TSchema
  apply: ApplyHandlers
  scenarios?: readonly unknown[]
  handle: (
    db: SqliteRemoteDatabase,
    command: z.infer<TSchema>,
  ) => Effect.Effect<Event[], unknown, any>
}

export type ProjectionSlice<
  TName extends string = string,
  TSchema extends z.ZodType = z.ZodType,
> = {
  kind: 'projection'
  name: TName
  schema: TSchema
  apply: ApplyHandlers
  scenarios?: readonly unknown[]
  handle: (
    db: SqliteRemoteDatabase,
    query: z.infer<TSchema>,
  ) => Effect.Effect<unknown, unknown, any>
}

export type CommandDispatch = (
  command: CommandEnvelope,
) => Effect.Effect<PersistedEvent[], unknown, any>

export type ReactionExec<TPayload = CommandEnvelope> = (
  reaction: TPayload,
) => Effect.Effect<unknown, unknown, any>

export type ReactionPlugin<TPayload = CommandEnvelope> = (
  command: CommandDispatch,
) => Effect.Effect<ReactionExec<TPayload>, unknown, unknown>

export type ReactionSlice<
  TName extends string = string,
  TPayload = CommandEnvelope,
> = {
  kind: 'reaction'
  name: TName
  apply: ApplyHandlers
  plugin?: ReactionPlugin<TPayload>
  scenarios?: readonly unknown[]
  handle: (
    db: SqliteRemoteDatabase,
  ) => Effect.Effect<TPayload | undefined, unknown, any>
}

export type SliceRegistration =
  | CommandSlice
  | ProjectionSlice
  | ReactionSlice<string, any>
