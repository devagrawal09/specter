import { z } from 'zod'

import { sqliteSliceStore } from '../../../db/specter-store'
import { todoAddedEvent } from '../events'
import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'

const maxTitleLength = 120

export const addTodo = implementCommand(specification)
  .inputSchema(
    z.object({
      todoId: z.string().min(1),
      title: z.string(),
    }),
  )
  .store(sqliteSliceStore)
  .handle(async (command) => {
    const title = command.title.trim()

    if (!title) {
      throw new Error('Todo title is required')
    }

    if (title.length > maxTitleLength) {
      throw new Error(`Todo title must be ${maxTitleLength} characters or less`)
    }

    return [todoAddedEvent.create({ todoId: command.todoId, title })]
  })
