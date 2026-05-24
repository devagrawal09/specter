import * as Schema from 'effect/Schema'
import { createCommandSpec } from '../../../lib2/builders'
import { errorEvent, todoAddedEvent } from '../events'

const maxTitleLength = 120

const addTodoSql = createCommandSpec('addTodo')
  .schema(
    Schema.Struct({
      title: Schema.String,
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
  .handle((_input, command) => {
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

export default addTodoSql
