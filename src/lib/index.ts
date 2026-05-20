import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type { z } from 'zod'

const eventBrand: unique symbol = Symbol('todoEvent')

export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  payload: text('payload').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

type EventFor<TType extends string, TPayload> = {
  readonly [eventBrand]: TType
  id: string
  type: TType
  payload: TPayload
}

type UnknownEvent = { id: string; type: string; payload: unknown }

export type StoreTx = Pick<
  // biome-ignore lint/suspicious/noExplicitAny: explicit any
  BetterSQLite3Database<any>,
  'delete' | 'insert' | 'select' | 'update'
>

export function createEventSpec<
  const TType extends string,
  TSchema extends z.ZodType,
>(type: TType, schema: TSchema) {
  type Payload = z.infer<TSchema>
  type TypedEvent = EventFor<TType, Payload>

  return {
    type,
    schema,
    create(payload: Payload): TypedEvent {
      return Object.defineProperty(
        {
          id: crypto.randomUUID(),
          type,
          payload: schema.parse(payload),
        },
        eventBrand,
        { value: type },
      ) as TypedEvent
    },
    is<TEvent extends UnknownEvent>(
      event: TEvent,
    ): event is TEvent & TypedEvent {
      return event.type === type && schema.safeParse(event.payload).success
    },
  }
}
