import * as Schema from 'effect/Schema'

type AnySchema = Schema.Schema.AnyNoContext
type SchemaType<TSchema extends AnySchema> = Schema.Schema.Type<TSchema>

export type Event<TType extends string = string, TPayload = unknown> = {
  id: string
  type: TType
  payload: TPayload
}

export type PersistedEvent<
  TType extends string = string,
  TPayload = unknown,
> = Event<TType, TPayload> & {
  order: number
}

export type EventSpec<TType extends string = string, TPayload = unknown> = {
  type: TType
  schema: AnySchema
  create: (payload: TPayload) => Event<TType, TPayload>
  is: (event: Event) => event is Event<TType, TPayload>
}

export function createEventSpec<
  const TType extends string,
  TSchema extends AnySchema,
>(type: TType, schema: TSchema): EventSpec<TType, SchemaType<TSchema>> {
  const decode = Schema.decodeUnknownSync(schema)
  const isPayload = Schema.is(schema)

  return {
    type,
    schema,
    create: (payload) => ({
        id: crypto.randomUUID(),
        type,
        payload: decode(payload),
      }),
    is: (event): event is Event<TType, SchemaType<TSchema>> =>
      event.type === type && isPayload(event.payload),
  }
}
