import { describe, expect } from 'vitest'

import { commandScenario } from '../../shared/test-scenario'

describe('adding todos', () => {
  commandScenario(
    'given a title, when a todo is added, then the todo is saved with that title',
  )
    .given()
    .when({ type: 'addTodo', payload: { title: 'Ship it' } })
    .expect((result) =>
      expect(result).toEqual([
        expect.objectContaining({
          id: expect.any(String),
          type: 'todoAdded',
          payload: expect.objectContaining({ title: 'Ship it' }),
        }),
      ]),
    )

  commandScenario(
    'given a title with extra spaces, when a todo is added, then the saved title is trimmed',
  )
    .given()
    .when({ type: 'addTodo', payload: { title: '  Ship it  ' } })
    .expect(([event]) => {
      if (event.type !== 'todoAdded') {
        throw new Error(`Expected saved todo, received ${event.type}`)
      }

      expect(event.payload.title).toBe('Ship it')
    })

  commandScenario(
    'given a blank title, when a todo is added, then the title is rejected',
  )
    .given()
    .when({ type: 'addTodo', payload: { title: '   ' } })
    .throws('Todo title is required')

  commandScenario(
    'given a title over 120 characters, when a todo is added, then the title is rejected',
  )
    .given()
    .when({ type: 'addTodo', payload: { title: 'x'.repeat(121) } })
    .throws('Todo title must be 120 characters or less')
})
