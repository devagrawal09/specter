import { and, eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import * as Either from 'effect/Either'
import * as Schema from 'effect/Schema'
import { createQuerySlice } from '@specter-ts/core'
import { runSql, selectSql, sqliteSliceStore } from '../../../specter-sqlite'
import {
  todoAddedEvent,
  todoCompletionChangedEvent,
  todoRemovedEvent,
} from '../events'

export const todoSqlListItems = sqliteTable('todo_sql_list_items', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
  removed: integer('removed', { mode: 'boolean' }).default(false),
})

export type TodoSqlListItem = typeof todoSqlListItems.$inferSelect

const todosSqlQuery = createQuerySlice('todosQuery')
  .schema(
    Schema.Struct({
      status: Schema.Literal('all', 'active', 'completed').annotations({
        decodingFallback: () => Either.right('all' as const),
      }),
    }),
  )
  .store(sqliteSliceStore)
  .apply({
    [todoAddedEvent.type]: async (event, input) => {
      const db = input
      const payload = todoAddedEvent.decode(event.payload)

      runSql(
        db.insert(todoSqlListItems).values({
          id: payload.todoId,
          title: payload.title,
          completed: false,
        }),
      )
    },
    [todoCompletionChangedEvent.type]: async (event, input) => {
      const db = input
      const payload = todoCompletionChangedEvent.decode(event.payload)

      runSql(
        db
          .update(todoSqlListItems)
          .set({ completed: payload.completed })
          .where(eq(todoSqlListItems.id, payload.todoId)),
      )
    },
    [todoRemovedEvent.type]: async (event, input) => {
      const db = input
      const payload = todoRemovedEvent.decode(event.payload)

      runSql(
        db
          .update(todoSqlListItems)
          .set({ removed: true })
          .where(eq(todoSqlListItems.id, payload.todoId)),
      )
    },
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
  .handle(async (query, db) => {
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

    return selectSql(db.select().from(todoSqlListItems).where(statusPredicate))
  })

export default todosSqlQuery
