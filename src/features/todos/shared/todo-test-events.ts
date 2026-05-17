import type { TodoEvent } from './todo-events'

export const firstDate = new Date('2026-01-01T00:00:00.000Z')
export const secondDate = new Date('2026-01-02T00:00:00.000Z')
export const thirdDate = new Date('2026-01-03T00:00:00.000Z')

export function todoAdded(
  todoId: string,
  title: string,
  createdAt = firstDate,
): TodoEvent {
  return {
    type: 'todoAdded',
    payload: { todoId, title, createdAt: createdAt.toISOString() },
  }
}

export function todoCompleted(
  todoId: string,
  updatedAt = secondDate,
): TodoEvent {
  return {
    type: 'todoCompletionChanged',
    payload: { todoId, completed: true, updatedAt: updatedAt.toISOString() },
  }
}

export function todoRemoved(todoId: string, removedAt = thirdDate): TodoEvent {
  return {
    type: 'todoRemoved',
    payload: { todoId, removedAt: removedAt.toISOString() },
  }
}
