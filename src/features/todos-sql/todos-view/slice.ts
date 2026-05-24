import { and, eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { Effect } from 'effect'
import * as Either from 'effect/Either'
import * as Schema from 'effect/Schema'
import { createProjectionSpec } from '../../../lib2/builders'
import {
  todoAddedEvent,
  todoCompletionChangedEvent,
  todoRemovedEvent,
} from '../../todos-json/events'

export const todoSqlListItems = sqliteTable('todo_sql_list_items', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
  removed: integer('removed', { mode: 'boolean' }).default(false),
})

const todosSqlProjection = createProjectionSpec('todosProjection')
  .schema(
    Schema.Struct({
      status: Schema.Literal('all', 'active', 'completed').annotations({
        decodingFallback: () => Either.right('all' as const),
      }),
    }),
  )
  .apply({
    [todoAddedEvent.type]: (event, input) =>
      Effect.gen(function* () {
        const db = input
        const payload = event.payload as { todoId: string; title: string }

        yield* db.insert(todoSqlListItems).values({
          id: payload.todoId,
          title: payload.title,
          completed: false,
        })
      }),
    [todoCompletionChangedEvent.type]: (event, input) =>
      Effect.gen(function* () {
        const db = input
        const payload = event.payload as { todoId: string; completed: boolean }

        yield* db
          .update(todoSqlListItems)
          .set({ completed: payload.completed })
          .where(eq(todoSqlListItems.id, payload.todoId))
      }),
    [todoRemovedEvent.type]: (event, input) =>
      Effect.gen(function* () {
        const db = input
        const payload = event.payload as { todoId: string }

        yield* db
          .update(todoSqlListItems)
          .set({ removed: true })
          .where(eq(todoSqlListItems.id, payload.todoId))
      }),
  })
  .scenarios(
    {
      given: [],
      when: { status: 'all' },
      expect: [],
    },
    {
      given: [
        todoAddedEvent.create({ todoId: 'todo-1', title: 'Ship it' }),
        todoAddedEvent.create({ todoId: 'todo-2', title: 'Review it' }),
      ],
      when: { status: 'all' },
      expect: [
        { id: 'todo-1', title: 'Ship it', completed: false, removed: false },
        { id: 'todo-2', title: 'Review it', completed: false, removed: false },
      ],
    },
    {
      given: [
        todoAddedEvent.create({ todoId: 'todo-1', title: 'Ship it' }),
        todoCompletionChangedEvent.create({
          todoId: 'todo-1',
          completed: true,
        }),
        todoAddedEvent.create({ todoId: 'todo-2', title: 'Review it' }),
      ],
      when: { status: 'active' },
      expect: [
        { id: 'todo-2', title: 'Review it', completed: false, removed: false },
      ],
    },
    {
      given: [
        todoAddedEvent.create({ todoId: 'todo-1', title: 'Ship it' }),
        todoCompletionChangedEvent.create({
          todoId: 'todo-1',
          completed: true,
        }),
        todoAddedEvent.create({ todoId: 'todo-2', title: 'Review it' }),
      ],
      when: { status: 'completed' },
      expect: [
        { id: 'todo-1', title: 'Ship it', completed: true, removed: false },
      ],
    },
    {
      given: [
        todoAddedEvent.create({ todoId: 'todo-1', title: 'Ship it' }),
        todoRemovedEvent.create({ todoId: 'todo-1' }),
      ],
      when: { status: 'all' },
      expect: [],
    },
  )
  .handle((input, query) =>
    Effect.gen(function* () {
      const db = input
      const visiblePredicate = eq(todoSqlListItems.removed, false)
      const activePredicate = and(
        visiblePredicate,
        eq(todoSqlListItems.completed, false),
      )
      const completedPredicate = and(
        visiblePredicate,
        eq(todoSqlListItems.completed, true),
      )

      const statusPredicate =
        query.status === 'active'
          ? activePredicate
          : query.status === 'completed'
            ? completedPredicate
            : visiblePredicate

      return yield* db.select().from(todoSqlListItems).where(statusPredicate)
    }),
  )

export default todosSqlProjection
