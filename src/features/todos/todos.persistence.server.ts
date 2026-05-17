import { asc, desc, isNull } from 'drizzle-orm'

import { db } from '../../db/client.server'
import { todoEvents, todoListItems } from '../../db/schema'
import type { TodoEvent } from './shared/todo-events'
import type {
  StoredTodoEvent,
  TodoStore,
} from './shared/todo-persistence-types'
import type { TodoStatusFilter } from './shared/todo-types'
import { applyChangeTodoCompletionEvents } from './slices/change-todo-completion/slice'
import { applyRemoveTodoEvents } from './slices/remove-todo/slice'
import { createTodosView } from './slices/todos-view/slice'
import { applyTodosViewEvents } from './slices/todos-view/slice'
import { decideTodoCommand, type TodoCommand } from './todos.functions'

export function readVisibleSnapshotsFromStore(
  tx: TodoStore,
  status: TodoStatusFilter,
) {
  const rows = tx
    .select()
    .from(todoListItems)
    .where(isNull(todoListItems.removedAt))
    .orderBy(asc(todoListItems.completed), desc(todoListItems.createdAt))
    .all()

  return createTodosView(
    rows.map((row) => ({
      id: row.id,
      title: row.title,
      completed: row.completed,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      removedAt: row.removedAt?.toISOString() ?? null,
    })),
    status,
  )
}

export function readVisibleSnapshots(status: TodoStatusFilter) {
  return readVisibleSnapshotsFromStore(db, status)
}

function insertEvents(tx: TodoStore, events: TodoEvent[]): StoredTodoEvent[] {
  if (events.length === 0) {
    return []
  }

  const storedEvents: StoredTodoEvent[] = []

  for (const event of events) {
    const row = tx
      .insert(todoEvents)
      .values({
        type: event.type,
        payload: JSON.stringify(event.payload),
        createdAt: eventCreatedAt(event),
      })
      .returning({
        id: todoEvents.id,
        type: todoEvents.type,
        payload: todoEvents.payload,
      })
      .get()

    if (!row) {
      throw new Error('Failed to persist todo event')
    }

    storedEvents.push(parseStoredTodoEvent(row))
  }

  return storedEvents
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

function parseStoredTodoEvent(row: {
  id: number
  type: string
  payload: string
}): StoredTodoEvent {
  const payload: unknown = JSON.parse(row.payload)

  if (row.type === 'todoAdded') {
    return {
      id: row.id,
      type: row.type,
      payload: payload as Extract<TodoEvent, { type: 'todoAdded' }>['payload'],
    }
  }

  if (row.type === 'todoCompletionChanged') {
    return {
      id: row.id,
      type: row.type,
      payload: payload as Extract<
        TodoEvent,
        { type: 'todoCompletionChanged' }
      >['payload'],
    }
  }

  if (row.type === 'todoRemoved') {
    return {
      id: row.id,
      type: row.type,
      payload: payload as Extract<
        TodoEvent,
        { type: 'todoRemoved' }
      >['payload'],
    }
  }

  throw new Error(`Unsupported todo event type: ${row.type}`)
}

function applyEventsToSlices(tx: TodoStore, events: StoredTodoEvent[]) {
  applyChangeTodoCompletionEvents(tx, events)
  applyRemoveTodoEvents(tx, events)
  applyTodosViewEvents(tx, events)
}

export function persistTodoCommand(command: TodoCommand) {
  let events: TodoEvent[] = []

  db.transaction((tx) => {
    events = persistTodoCommandInTransaction(tx, command)
  })

  return events
}

export function persistTodoCommandInTransaction(
  tx: TodoStore,
  command: TodoCommand,
) {
  const events = decideTodoCommand(tx, command)
  const storedEvents = insertEvents(tx, events)
  applyEventsToSlices(tx, storedEvents)

  return events
}
