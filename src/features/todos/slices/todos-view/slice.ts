import { eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { lazy } from 'solid-js'
import { z } from 'zod'
import { createProjectionSpec } from '../../registry.builders'
import {
  todoAddedEvent,
  todoCompletionChangedEvent,
  todoRemovedEvent,
} from '../../shared/events'

const todoStatusFilterInput = z.enum(['all', 'active', 'completed'])

export const todosViewQueryInput = z.object({
  status: todoStatusFilterInput.catch('all'),
})

export type TodoStatusFilter = z.infer<typeof todoStatusFilterInput>

export const todoListItems = sqliteTable('todo_list_items', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
  removed: integer('removed', { mode: 'boolean' }).default(false),
})

export const todosViewSliceRegistration = createProjectionSpec('todosView')
  .schema(todosViewQueryInput)
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
      expect: {
        visible: ['empty-state'],
        hidden: ['todo-list'],
        text: {
          'empty-message': 'No todos yet.',
          'todo-summary': '0 total · 0 active · 0 completed',
        },
        count: { 'todo-item': 0 },
      },
    },
    {
      given: [
        todoAddedEvent.create({ todoId: 'todo-1', title: 'Ship it' }),
        todoAddedEvent.create({ todoId: 'todo-2', title: 'Review it' }),
      ],
      when: { status: 'all' },
      expect: {
        visible: ['todo-list'],
        hidden: ['empty-state'],
        text: {
          'todo-summary': '2 total · 2 active · 0 completed',
          'todo-title-todo-1': 'Ship it',
          'todo-title-todo-2': 'Review it',
        },
        count: { 'todo-item': 2 },
      },
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
      expect: {
        visible: ['todo-list'],
        hidden: ['empty-state'],
        text: {
          'todo-summary': '1 total · 1 active · 0 completed',
          'todo-title-todo-2': 'Review it',
        },
        count: { 'todo-item': 1 },
      },
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
      expect: {
        visible: ['todo-list'],
        hidden: ['empty-state'],
        text: {
          'todo-summary': '1 total · 0 active · 1 completed',
          'todo-title-todo-1': 'Ship it',
        },
        count: { 'todo-item': 1 },
      },
    },
    {
      given: [
        todoAddedEvent.create({ todoId: 'todo-1', title: 'Ship it' }),
        todoRemovedEvent.create({ todoId: 'todo-1' }),
      ],
      when: { status: 'all' },
      expect: {
        visible: ['empty-state'],
        hidden: ['todo-list'],
        text: {
          'empty-message': 'No todos yet.',
          'todo-summary': '0 total · 0 active · 0 completed',
        },
        count: { 'todo-item': 0 },
      },
    },
  )
  .component(
    lazy(() =>
      import('./TodosView').then((module) => ({ default: module.TodosView })),
    ),
  )
