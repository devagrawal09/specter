import { asc, desc, eq, isNull } from 'drizzle-orm'
import { createServerFn } from '@tanstack/solid-start'
import { z } from 'zod'

import { db } from '../../db/client.server'
import { todoEvents, todos } from '../../db/schema'
import {
  createTodosView,
  handleAddTodo,
  handleChangeTodoCompletion,
  handleRemoveTodo,
  parseTodoStatusFilter,
  type TodoEvent,
  type TodoSnapshot,
  type TodoStatusFilter,
} from './todos.slice'

type TodoRow = typeof todos.$inferSelect

const listTodosInput = z.object({
  status: z
    .unknown()
    .optional()
    .transform((status) => parseTodoStatusFilter(status)),
})

const addTodoInput = z.object({
  title: z.string(),
})

const changeTodoCompletionInput = z.object({
  todoId: z.string().min(1, 'Todo id is required'),
  completed: z.boolean(),
})

const removeTodoInput = z.object({
  todoId: z.string().min(1, 'Todo id is required'),
})

function rowToSnapshot(row: TodoRow): TodoSnapshot {
  return {
    id: row.id,
    title: row.title,
    completed: row.completed,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    removedAt: row.removedAt?.toISOString() ?? null,
  }
}

function readSnapshots(tx = db) {
  return tx.select().from(todos).all().map(rowToSnapshot)
}

function readVisibleSnapshots(status: TodoStatusFilter) {
  const rows = db
    .select()
    .from(todos)
    .where(isNull(todos.removedAt))
    .orderBy(asc(todos.completed), desc(todos.createdAt))
    .all()

  return createTodosView(rows.map(rowToSnapshot), status)
}

function insertEvents(tx: typeof db, events: TodoEvent[]) {
  if (events.length === 0) {
    return
  }

  tx.insert(todoEvents)
    .values(
      events.map((event) => ({
        type: event.type,
        payload: JSON.stringify(event.payload),
        createdAt: eventCreatedAt(event),
      })),
    )
    .run()
}

function eventCreatedAt(event: TodoEvent) {
  if (event.type === 'todoAdded') {
    return new Date(event.payload.createdAt)
  }

  if (event.type === 'todoCompletionChanged') {
    return new Date(event.payload.updatedAt)
  }

  return new Date(event.payload.removedAt)
}

function applyEventsToSnapshots(tx: typeof db, events: TodoEvent[]) {
  for (const event of events) {
    if (event.type === 'todoAdded') {
      const createdAt = new Date(event.payload.createdAt)

      tx.insert(todos)
        .values({
          id: event.payload.todoId,
          title: event.payload.title,
          completed: false,
          createdAt,
          updatedAt: createdAt,
          removedAt: null,
        })
        .run()
    }

    if (event.type === 'todoCompletionChanged') {
      tx.update(todos)
        .set({
          completed: event.payload.completed,
          updatedAt: new Date(event.payload.updatedAt),
        })
        .where(eq(todos.id, event.payload.todoId))
        .run()
    }

    if (event.type === 'todoRemoved') {
      const removedAt = new Date(event.payload.removedAt)

      tx.update(todos)
        .set({ updatedAt: removedAt, removedAt })
        .where(eq(todos.id, event.payload.todoId))
        .run()
    }
  }
}

function persistCommand(events: TodoEvent[]) {
  db.transaction((tx) => {
    insertEvents(tx, events)
    applyEventsToSnapshots(tx, events)
  })
}

export const listTodos = createServerFn({ method: 'GET' })
  .inputValidator(listTodosInput)
  .handler(async ({ data }) => readVisibleSnapshots(data.status))

export const addTodo = createServerFn({ method: 'POST' })
  .inputValidator(addTodoInput)
  .handler(async ({ data }) => {
    const events = handleAddTodo(data)

    persistCommand(events)

    return readVisibleSnapshots('all')
  })

export const changeTodoCompletion = createServerFn({ method: 'POST' })
  .inputValidator(changeTodoCompletionInput)
  .handler(async ({ data }) => {
    db.transaction((tx) => {
      const currentState = readSnapshots(tx)
      const commandEvents = handleChangeTodoCompletion(currentState, data)

      insertEvents(tx, commandEvents)
      applyEventsToSnapshots(tx, commandEvents)
    })

    return readVisibleSnapshots('all')
  })

export const removeTodo = createServerFn({ method: 'POST' })
  .inputValidator(removeTodoInput)
  .handler(async ({ data }) => {
    db.transaction((tx) => {
      const currentState = readSnapshots(tx)
      const events = handleRemoveTodo(currentState, data)

      insertEvents(tx, events)
      applyEventsToSnapshots(tx, events)
    })

    return readVisibleSnapshots('all')
  })
