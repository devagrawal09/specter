import z from 'zod'
import { createCommandSpec } from '../../registry.builders'
import { todoAddedEvent } from '../../shared'

const maxTitleLength = 120

export const addTodoSliceRegistration = createCommandSpec('addTodo')
  .schema(
    z.object({
      title: z.string(),
    }),
  )
  .decide((command) => {
    const title = command.title.trim()

    if (!title) {
      throw new Error('Todo title is required')
    }

    if (title.length > maxTitleLength) {
      throw new Error(`Todo title must be ${maxTitleLength} characters or less`)
    }

    return [todoAddedEvent.create({ todoId: crypto.randomUUID(), title })]
  })
