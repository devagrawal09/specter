import * as Schema from 'effect/Schema'

type AnySchema = Schema.Schema.AnyNoContext
type SchemaType<TSchema extends AnySchema> = Schema.Schema.Type<TSchema>

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
  schema: AnySchema
  create: (payload: TPayload) => EventDraft<TType, TPayload>
  decode: (payload: unknown) => TPayload
  is: (event: EventDraft) => event is EventDraft<TType, TPayload>
}

export function createEventDefinition<
  const TType extends string,
  TSchema extends AnySchema,
>(type: TType, schema: TSchema): EventDefinition<TType, SchemaType<TSchema>> {
  const decode = Schema.decodeUnknownSync(schema)
  const isPayload = Schema.is(schema)

  return {
    type,
    schema,
    create: (payload) => ({
      type,
      payload: decode(payload),
    }),
    decode,
    is: (event): event is EventDraft<TType, SchemaType<TSchema>> =>
      event.type === type && isPayload(event.payload),
  }
}
