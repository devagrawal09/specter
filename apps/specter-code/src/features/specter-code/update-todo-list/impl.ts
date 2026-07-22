import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'
import { z } from 'zod'

import { defineMemorySliceStore } from '../../../testing/memory-slice-store'
import { todoListUpdatedEvent } from '../events'

const todoItemSchema = z.object({
  id: z.string(),
  content: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed']),
  priority: z.enum(['low', 'medium', 'high']).optional(),
})

const updateTodoList = implementCommand(specification)
  .inputSchema(
    z.object({
      sessionId: z.string(),
      messageId: z.string(),
      items: z.array(todoItemSchema),
    }),
  )
  .store(defineMemorySliceStore(() => ({})))

  .handle(async (command) => {
    return [
      todoListUpdatedEvent.create({
        sessionId: command.sessionId,
        messageId: command.messageId,
        items: command.items.map((item) => {
          const content = item.content.trim()
          if (!content) throw new Error('Todo content is required')
          return {
            id: item.id,
            content,
            status: item.status,
            priority: item.priority,
          }
        }),
      }),
    ]
  })

export default updateTodoList
