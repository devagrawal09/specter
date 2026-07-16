import type { StandardSchemaV1 } from '@standard-schema/spec'

import { decodeSchema } from './schemas'

export type EventDraft<TType extends string = string, TPayload = unknown> = {
  readonly type: TType
  readonly payload: TPayload
}

export type Event<
  TType extends string = string,
  TPayload = unknown,
> = EventDraft<TType, TPayload> & {
  readonly id: string
  readonly recordedAt: string
}

export type PersistedEvent<
  TType extends string = string,
  TPayload = unknown,
> = Event<TType, TPayload> & {
  readonly order: number
}

export type EventDefinition<
  TType extends string = string,
  TPayload = unknown,
> = {
  readonly type: TType
  readonly schema: StandardSchemaV1
  readonly create: (payload: TPayload) => EventDraft<TType, TPayload>
  readonly decode: (payload: unknown) => Promise<TPayload>
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
