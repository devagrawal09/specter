import type { TodoEvent } from '../../shared/todo-events'
import type { TodoSnapshot } from '../../shared/todo-types'

export type RemoveTodoCommand = { todoId: string }

export function handleRemoveTodo(
  state: TodoSnapshot[],
  command: RemoveTodoCommand,
  now = new Date(),
): TodoEvent[] {
  const todo = state.find((candidate) => candidate.id === command.todoId)

  if (!todo || todo.removedAt) {
    throw new Error('Todo not found')
  }

  return [
    {
      type: 'todoRemoved',
      payload: { todoId: command.todoId, removedAt: now.toISOString() },
    },
  ]
}
