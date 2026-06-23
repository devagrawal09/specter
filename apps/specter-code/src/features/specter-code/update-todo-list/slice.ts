import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { todoListUpdatedEvent } from '../events'

const todoItemSchema = z.object({
  id: z.string().optional(),
  content: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed']),
  priority: z.enum(['low', 'medium', 'high']).optional(),
})

const updateTodoList = createCommandSlice(
  'updateTodoList',
  'Records the latest todo list for an OpenCode-style session.',
)
  .schema(
    z.object({
      sessionId: z.string(),
      messageId: z.string(),
      items: z.array(todoItemSchema),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .scenarios(
    {
      description: 'Records a normalized todo list for a session message.',
      given: [],
      when: {
        sessionId: 'session-todos-1',
        messageId: 'message-todos-1',
        items: [
          { id: 'todo-1', content: ' Inspect failure ', status: 'in_progress', priority: 'high' },
          { id: 'todo-2', content: 'Ship fix', status: 'pending' },
        ],
      },
      expect: [
        todoListUpdatedEvent.create({
          sessionId: 'session-todos-1',
          messageId: 'message-todos-1',
          items: [
            { id: 'todo-1', content: 'Inspect failure', status: 'in_progress', priority: 'high' },
            { id: 'todo-2', content: 'Ship fix', status: 'pending' },
          ],
        }),
      ],
    },
    {
      description: 'Rejects todos with empty content.',
      given: [],
      when: {
        sessionId: 'session-todos-1',
        messageId: 'message-todos-1',
        items: [{ id: 'todo-empty', content: '   ', status: 'pending' }],
      },
      expect: [],
      reject: { reason: 'Todo content is required' },
    },
  )
  .handle(async (command) => {
    return [
      todoListUpdatedEvent.create({
        sessionId: command.sessionId,
        messageId: command.messageId,
        items: command.items.map((item) => {
          const content = item.content.trim()
          if (!content) throw new Error('Todo content is required')
          return {
            id: item.id ?? crypto.randomUUID(),
            content,
            status: item.status,
            priority: item.priority,
          }
        }),
      }),
    ]
  })

export default updateTodoList
