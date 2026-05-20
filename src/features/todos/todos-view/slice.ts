import { and, eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { createProjectionSpec } from '../../../lib/registry.builders'
import {
  todoAddedEvent,
  todoCompletionChangedEvent,
  todoRemovedEvent,
} from '../events'

export const todoListItems = sqliteTable('todo_list_items', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
  removed: integer('removed', { mode: 'boolean' }).default(false),
})

export const todosProjection = createProjectionSpec('todosProjection')
  .schema(
    z.object({
      status: z.enum(['all', 'active', 'completed']).catch('all'),
    }),
  )
  .apply({
    [todoAddedEvent.type]: (event, tx) => {
      tx.insert(todoListItems)
        .values({
          id: event.payload.todoId,
          title: event.payload.title,
          completed: false,
        })
        .run()
    },
    [todoCompletionChangedEvent.type]: (event, tx) => {
      tx.update(todoListItems)
        .set({
          completed: event.payload.completed,
        })
        .where(eq(todoListItems.id, event.payload.todoId))
        .run()
    },
    [todoRemovedEvent.type]: (event, tx) => {
      tx.update(todoListItems)
        .set({
          removed: true,
        })
        .where(eq(todoListItems.id, event.payload.todoId))
        .run()
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
  .query((tx, input) => {
    const visiblePredicate = eq(todoListItems.removed, false)

    const activePredicate = and(
      visiblePredicate,
      eq(todoListItems.completed, false),
    )

    const completedPredicate = and(
      visiblePredicate,
      eq(todoListItems.completed, true),
    )

    const statusPredicate =
      input.status === 'active'
        ? activePredicate
        : input.status === 'completed'
          ? completedPredicate
          : visiblePredicate

    return tx.select().from(todoListItems).where(statusPredicate).all()
  })
