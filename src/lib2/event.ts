import type { z } from 'zod'

declare const eventBrand: unique symbol

export type Event<TType extends string = string, TPayload = unknown> = {
  readonly [eventBrand]: TType
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
  schema: z.ZodType
  create: (payload: TPayload) => Event<TType, TPayload>
  is: (event: Event) => event is Event<TType, TPayload>
}

export function createEventSpec<
  const TType extends string,
  TSchema extends z.ZodType,
>(type: TType, schema: TSchema): EventSpec<TType, z.infer<TSchema>> {
  return {
    type,
    schema,
    create: (payload) =>
      ({
        id: crypto.randomUUID(),
        type,
        payload: schema.parse(payload),
      }) as Event<TType, z.infer<TSchema>>,
    is: (event): event is Event<TType, z.infer<TSchema>> =>
      event.type === type && schema.safeParse(event.payload).success,
  }
}
