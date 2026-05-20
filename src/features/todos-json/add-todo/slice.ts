import z from 'zod'
import { createCommandSpec } from '../../../lib_legacy/registry.builders'
import { errorEvent, todoAddedEvent } from '../events'

const maxTitleLength = 120

export const addTodo = createCommandSpec('addTodo', { json: true })
  .schema(
    z.object({
      title: z.string(),
    }),
  )
  .scenarios(
    {
      given: [],
      when: { title: 'Ship it' },
      expect: [
        todoAddedEvent.create({ todoId: 'generated', title: 'Ship it' }),
      ],
    },
    {
      given: [],
      when: { title: '  Ship it  ' },
      expect: [
        todoAddedEvent.create({ todoId: 'generated', title: 'Ship it' }),
      ],
    },
    {
      given: [],
      when: { title: '   ' },
      expect: [errorEvent.create({ message: 'Todo title is required' })],
    },
    {
      given: [],
      when: { title: 'x'.repeat(maxTitleLength + 1) },
      expect: [
        errorEvent.create({
          message: `Todo title must be ${maxTitleLength} characters or less`,
        }),
      ],
    },
  )
  .decide((command) => {
    const title = command.title.trim()

    if (!title) {
      return [errorEvent.create({ message: 'Todo title is required' })]
    }

    if (title.length > maxTitleLength) {
      return [
        errorEvent.create({
          message: `Todo title must be ${maxTitleLength} characters or less`,
        }),
      ]
    }

    return [todoAddedEvent.create({ todoId: crypto.randomUUID(), title })]
  })
