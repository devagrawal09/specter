import * as Schema from 'effect/Schema'
import { createCommandSlice, rejectCommand } from '@specter-ts/core'
import { sqliteSliceStore } from '../../../specter-sqlite'
import { todoAddedEvent } from '../events'

const maxTitleLength = 120

const addTodoSql = createCommandSlice('addTodo')
  .schema(
    Schema.Struct({
      title: Schema.String,
    }),
  )
  .store(sqliteSliceStore)
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
      expect: [],
      reject: { reason: 'Todo title is required' },
    },
    {
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
      rejectCommand('Todo title is required')
    }

    if (title.length > maxTitleLength) {
      rejectCommand(`Todo title must be ${maxTitleLength} characters or less`)
    }

    return [todoAddedEvent.create({ todoId: crypto.randomUUID(), title })]
  })

export default addTodoSql
