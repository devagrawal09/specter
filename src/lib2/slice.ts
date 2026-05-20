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
  ((event: Event, input: never) => Effect.Effect<void>) | undefined
>

export type CommandSlice<
  TName extends string = string,
  TSchema extends z.ZodType = z.ZodType,
> = {
  kind: 'command'
  name: TName
  schema: TSchema
  json?: boolean
  eager?: boolean
  apply?: ApplyHandlers
  decide: (payload: z.infer<TSchema>, input: never) => Effect.Effect<Event[]>
}

export type ProjectionSlice<
  TName extends string = string,
  TSchema extends z.ZodType = z.ZodType,
> = {
  kind: 'projection'
  name: TName
  schema: TSchema
  json?: boolean
  eager?: boolean
  apply: ApplyHandlers
  query: (input: never, query: z.infer<TSchema>) => Effect.Effect<unknown>
}

export type ReactionSlice<TName extends string = string> = {
  kind: 'reaction'
  name: TName
  json?: boolean
  eager?: boolean
  apply?: ApplyHandlers
  react: (input: never) => Effect.Effect<CommandEnvelope[]>
}

export type SliceRegistration = CommandSlice | ProjectionSlice | ReactionSlice
