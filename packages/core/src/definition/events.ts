import type { StandardSchemaV1 } from '@standard-schema/spec'

import { decodeSchema } from './schemas'

export type EventDraft<TType extends string = string, TPayload = unknown> = {
  type: TType
  payload: TPayload
}

export type Event<
  TType extends string = string,
  TPayload = unknown,
> = EventDraft<TType, TPayload> & {
  id: string
  recordedAt: Date
}

export type PersistedEvent<
  TType extends string = string,
  TPayload = unknown,
> = Event<TType, TPayload> & {
  order: number
}

export type EventDefinition<
  TType extends string = string,
  TPayload = unknown,
> = {
  type: TType
  schema: StandardSchemaV1
  create: (payload: TPayload) => EventDraft<TType, TPayload>
  decode: (payload: unknown) => Promise<TPayload>
}

export function createEventDefinition<
  const TType extends string,
  TSchema extends StandardSchemaV1,
>(
  type: TType,
  schema: TSchema,
): EventDefinition<TType, StandardSchemaV1.InferOutput<TSchema>> {
  const decode = (payload: unknown) => decodeSchema(schema, payload)

  return {
    type,
    schema,
    create: (payload) => ({
      type,
      payload,
    }),
    decode,
  }
}
