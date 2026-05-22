import type { z } from 'zod'
import type { Effect } from 'effect'

import type { Event } from './event'

export type CommandEnvelope<
  TName extends string = string,
  TPayload = unknown,
> = {
  name: TName
  payload: TPayload
}

export type ApplyHandlers = Record<
  string,
  (event: Event, input: unknown) => Effect.Effect<void, unknown>
>

export type CommandSlice<
  TName extends string = string,
  TSchema extends z.ZodType = z.ZodType,
> = {
  kind: 'command'
  name: TName
  schema: TSchema
  eager?: boolean
  apply: ApplyHandlers
  decide: (
    payload: z.infer<TSchema>,
    input: unknown,
  ) => Effect.Effect<Event[], unknown>
}

export type ProjectionSlice<
  TName extends string = string,
  TSchema extends z.ZodType = z.ZodType,
> = {
  kind: 'projection'
  name: TName
  schema: TSchema
  eager?: boolean
  apply: ApplyHandlers
  query: (
    input: unknown,
    query: z.infer<TSchema>,
  ) => Effect.Effect<unknown, unknown>
}

export type ReactionSlice<TName extends string = string> = {
  kind: 'reaction'
  name: TName
  apply: ApplyHandlers
  react: (input: unknown) => Effect.Effect<CommandEnvelope[], unknown>
}

export type SliceRegistration = CommandSlice | ProjectionSlice | ReactionSlice
