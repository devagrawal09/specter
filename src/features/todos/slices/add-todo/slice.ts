import { z } from 'zod'

import type { TodoEvent } from '../../shared/todo-events'

export type AddTodoCommand = { title: string }

const maxTitleLength = 120

export const addTodoInput = z.object({
  title: z.string(),
})

export function validateTodoTitle(title: string) {
  const normalizedTitle = title.trim()

  if (!normalizedTitle) {
    throw new Error('Todo title is required')
  }

  if (normalizedTitle.length > maxTitleLength) {
    throw new Error(`Todo title must be ${maxTitleLength} characters or less`)
  }

  return normalizedTitle
}

export function handleAddTodo(
  command: AddTodoCommand,
  now = new Date(),
  todoId = crypto.randomUUID(),
): TodoEvent[] {
  const title = validateTodoTitle(command.title)

  return [
    {
      type: 'todoAdded',
      payload: { todoId, title, createdAt: now.toISOString() },
    },
  ]
}
