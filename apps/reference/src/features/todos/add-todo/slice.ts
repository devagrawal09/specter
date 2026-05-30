import { z } from 'zod'
import { createCommandSlice } from '@specter-ts/core'
import { sqliteSliceStore } from '../../../db/specter-sqlite'
import { todoAddedEvent } from '../events'

const maxTitleLength = 120

const addTodo = createCommandSlice('addTodo', 'Adds a todo to the list.')
  .schema(
    z.object({
      title: z.string(),
    }),
  )
  .store(sqliteSliceStore)
  .scenarios(
    {
      description: 'Creates a todo with the provided title.',
      given: [],
      when: { title: 'Ship it' },
      expect: [
        todoAddedEvent.create({ todoId: 'generated', title: 'Ship it' }),
      ],
    },
    {
      description: 'Trims surrounding whitespace before creating a todo.',
      given: [],
      when: { title: '  Ship it  ' },
      expect: [
        todoAddedEvent.create({ todoId: 'generated', title: 'Ship it' }),
      ],
    },
    {
      description: 'Rejects a blank todo title.',
      given: [],
      when: { title: '   ' },
      expect: [],
      reject: { reason: 'Todo title is required' },
    },
    {
      description: 'Rejects a todo title longer than the limit.',
      given: [],
      when: { title: 'x'.repeat(maxTitleLength + 1) },
      expect: [],
      reject: {
        reason: `Todo title must be ${maxTitleLength} characters or less`,
      },
    },
  )
  .handle(async (command) => {
    const title = command.title.trim()

    if (!title) {
      throw new Error('Todo title is required')
    }

    if (title.length > maxTitleLength) {
      throw new Error(`Todo title must be ${maxTitleLength} characters or less`)
    }

    return [todoAddedEvent.create({ todoId: crypto.randomUUID(), title })]
  })

export default addTodo
