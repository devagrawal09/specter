import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { z } from 'zod'

export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(),
  payload: text('payload').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

type EventFor<TType extends string, TPayload> = {
  type: TType
  payload: TPayload
}

type UnknownEvent = { type: string; payload: unknown }

export type StoreTx = Pick<
  // biome-ignore lint/suspicious/noExplicitAny: explicit any
  BetterSQLite3Database<any>,
  'insert' | 'select' | 'update'
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
      return {
        type,
        payload: schema.parse(payload),
      }
    },
    is<TEvent extends UnknownEvent>(
      event: TEvent,
    ): event is TEvent & TypedEvent {
      return event.type === type && schema.safeParse(event.payload).success
    },
  }
}

export const todoAddedEvent = createEventSpec(
  'todoAdded',
  z.object({
    todoId: z.string(),
    title: z.string(),
  }),
)

export const todoCompletionChangedEvent = createEventSpec(
  'todoCompletionChanged',
  z.object({
    todoId: z.string(),
    completed: z.boolean(),
  }),
)

export const todoRemovedEvent = createEventSpec(
  'todoRemoved',
  z.object({
    todoId: z.string(),
  }),
)

export type Event =
  | ReturnType<typeof todoAddedEvent.create>
  | ReturnType<typeof todoCompletionChangedEvent.create>
  | ReturnType<typeof todoRemovedEvent.create>

export type StoredEvent = Event & {
  id: number
}
