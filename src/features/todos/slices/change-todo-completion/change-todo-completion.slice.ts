import type { TodoEvent } from '../../shared/todo-events'
import type { TodoSnapshot } from '../../shared/todo-types'

export type ChangeTodoCompletionCommand = {
  todoId: string
  completed: boolean
}

export function handleChangeTodoCompletion(
  state: TodoSnapshot[],
  command: ChangeTodoCompletionCommand,
  now = new Date(),
): TodoEvent[] {
  const todo = state.find((candidate) => candidate.id === command.todoId)

  if (!todo || todo.removedAt) {
    throw new Error('Todo not found')
  }

  if (todo.completed === command.completed) {
    return []
  }

  return [
    {
      type: 'todoCompletionChanged',
      payload: {
        todoId: command.todoId,
        completed: command.completed,
        updatedAt: now.toISOString(),
      },
    },
  ]
}
