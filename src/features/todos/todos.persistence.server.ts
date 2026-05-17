import { asc, desc, eq, isNull } from 'drizzle-orm'

import { db } from '../../db/client.server'
import { todoEvents, todos } from '../../db/schema'
import type { TodoEvent } from './shared/todo-events'
import type { TodoSnapshot, TodoStatusFilter } from './shared/todo-types'
import { createTodosView } from './slices/todos-view/todos-view.slice'
import { handleTodoCommand, type TodoCommand } from './todos.functions'

type TodoRow = typeof todos.$inferSelect
type TodoStore = Pick<typeof db, 'insert' | 'select' | 'update'>

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

function readSnapshots(tx: TodoStore = db) {
  return tx.select().from(todos).all().map(rowToSnapshot)
}

export function readVisibleSnapshots(status: TodoStatusFilter) {
  const rows = db
    .select()
    .from(todos)
    .where(isNull(todos.removedAt))
    .orderBy(asc(todos.completed), desc(todos.createdAt))
    .all()

  return createTodosView(rows.map(rowToSnapshot), status)
}

function insertEvents(tx: TodoStore, events: TodoEvent[]) {
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

function applyEventsToSnapshots(tx: TodoStore, events: TodoEvent[]) {
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

export function persistTodoCommand(command: TodoCommand) {
  let events: TodoEvent[] = []

  db.transaction((tx) => {
    const currentState = readSnapshots(tx)

    events = handleTodoCommand(currentState, command)

    insertEvents(tx, events)
    applyEventsToSnapshots(tx, events)
  })

  return events
}
