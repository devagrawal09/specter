import updateTodoListSpec from './spec'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { todoListUpdatedEvent } from '../events'

const todoItemSchema = z.object({
  id: z.string(),
  content: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed']),
  priority: z.enum(['low', 'medium', 'high']).optional(),
})

const updateTodoList = updateTodoListSpec
  .inputSchema(
    z.object({
      sessionId: z.string(),
      messageId: z.string(),
      items: z.array(todoItemSchema),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  
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
