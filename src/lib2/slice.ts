// biome-ignore-all lint/suspicious/noExplicitAny: slice callbacks can require arbitrary Effect services.
import type { z } from 'zod'
import type { Effect } from 'effect'

import type { Event, PersistedEvent } from './event'

export type CommandEnvelope<
  TName extends string = string,
  TPayload = unknown,
> = {
  name: TName
  payload: TPayload
}

export type ApplyHandlers = Record<
  string,
  (event: Event, input: unknown) => Effect.Effect<void, unknown, any>
>

export type CommandSlice<
  TName extends string = string,
  TSchema extends z.ZodType = z.ZodType,
> = {
  kind: 'command'
  name: TName
  schema: TSchema
  eager?: boolean
  apply?: ApplyHandlers
  decide: (
    payload: z.infer<TSchema>,
    input: unknown,
  ) => Effect.Effect<Event[], unknown, any>
}

export type ProjectionSlice<
  TName extends string = string,
  TSchema extends z.ZodType = z.ZodType,
> = {
  kind: 'projection'
  name: TName
  schema: TSchema
  eager?: boolean
  apply?: ApplyHandlers
  query: (
    input: unknown,
    query: z.infer<TSchema>,
  ) => Effect.Effect<unknown, unknown, any>
}

export type CommandDispatch = (
  command: CommandEnvelope,
) => Effect.Effect<PersistedEvent[], unknown, any>

export type ReactionExec<TPayload = CommandEnvelope> = (
  payload: TPayload,
) => Effect.Effect<void, unknown, any>

export type ReactionPlugin<TPayload = CommandEnvelope> = (
  dispatch: CommandDispatch,
) => Effect.Effect<ReactionExec<TPayload>, unknown, any>

export type ReactionSlice<
  TName extends string = string,
  TPayload = CommandEnvelope,
> = {
  kind: 'reaction'
  name: TName
  apply: ApplyHandlers
  plugin?: ReactionPlugin<TPayload>
  react: (exec: ReactionExec<TPayload>) => Effect.Effect<void, unknown, any>
}

export type SliceRegistration =
  | CommandSlice
  | ProjectionSlice
  | ReactionSlice<string, any>
