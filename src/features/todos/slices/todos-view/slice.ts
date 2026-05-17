import { eq } from 'drizzle-orm'
import { z } from 'zod'

import type { TodoEvent } from '../../shared/todo-events'
import type {
  StoredTodoEvent,
  TodoStore,
} from '../../shared/todo-persistence-types'
import type {
  TodoSnapshot,
  TodoStatusFilter,
  TodosView,
} from '../../shared/todo-types'
import { parseTodoStatusFilter } from '../../shared/todo-types'
import { todoListItems } from './schema'

export const listTodosInput = z.object({
  status: z
    .unknown()
    .optional()
    .transform((status) => parseTodoStatusFilter(status)),
})

export function projectTodoState(events: TodoEvent[]): TodoSnapshot[] {
  const todosById = new Map<string, TodoSnapshot>()

  for (const event of events) {
    if (event.type === 'todoAdded') {
      todosById.set(event.payload.todoId, {
        id: event.payload.todoId,
        title: event.payload.title,
        completed: false,
        createdAt: event.payload.createdAt,
        updatedAt: event.payload.createdAt,
        removedAt: null,
      })
    }

    if (event.type === 'todoCompletionChanged') {
      const todo = todosById.get(event.payload.todoId)

      if (todo) {
        todosById.set(todo.id, {
          ...todo,
          completed: event.payload.completed,
          updatedAt: event.payload.updatedAt,
        })
      }
    }

    if (event.type === 'todoRemoved') {
      const todo = todosById.get(event.payload.todoId)

      if (todo) {
        todosById.set(todo.id, {
          ...todo,
          updatedAt: event.payload.removedAt,
          removedAt: event.payload.removedAt,
        })
      }
    }
  }

  return Array.from(todosById.values())
}

export function projectTodos(
  events: TodoEvent[],
  status: TodoStatusFilter = 'all',
): TodosView {
  return createTodosView(projectTodoState(events), status)
}

export function createTodosView(
  snapshots: TodoSnapshot[],
  status: TodoStatusFilter = 'all',
): TodosView {
  const visibleTodos = snapshots.filter((todo) => !todo.removedAt)
  const activeCount = visibleTodos.filter((todo) => !todo.completed).length
  const completedCount = visibleTodos.filter((todo) => todo.completed).length

  const filteredTodos = visibleTodos
    .filter((todo) => {
      if (status === 'active') {
        return !todo.completed
      }

      if (status === 'completed') {
        return todo.completed
      }

      return true
    })
    .sort((left, right) => {
      if (status === 'all' && left.completed !== right.completed) {
        return Number(left.completed) - Number(right.completed)
      }

      return (
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      )
    })
    .map(({ removedAt: _removedAt, ...todo }) => todo)

  return {
    todos: filteredTodos,
    activeCount,
    completedCount,
    totalCount: visibleTodos.length,
  }
}

export function applyTodosViewEvents(tx: TodoStore, events: StoredTodoEvent[]) {
  for (const event of events) {
    if (event.type === 'todoAdded') {
      const createdAt = new Date(event.payload.createdAt)

      tx.insert(todoListItems)
        .values({
          id: event.payload.todoId,
          title: event.payload.title,
          completed: false,
          createdAt,
          updatedAt: createdAt,
          removedAt: null,
          lastAppliedEventId: event.id,
        })
        .run()
    }

    if (event.type === 'todoCompletionChanged') {
      tx.update(todoListItems)
        .set({
          completed: event.payload.completed,
          updatedAt: new Date(event.payload.updatedAt),
          lastAppliedEventId: event.id,
        })
        .where(eq(todoListItems.id, event.payload.todoId))
        .run()
    }

    if (event.type === 'todoRemoved') {
      const removedAt = new Date(event.payload.removedAt)

      tx.update(todoListItems)
        .set({
          updatedAt: removedAt,
          removedAt,
          lastAppliedEventId: event.id,
        })
        .where(eq(todoListItems.id, event.payload.todoId))
        .run()
    }
  }
}
