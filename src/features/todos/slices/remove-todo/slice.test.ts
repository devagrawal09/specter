import { eq } from 'drizzle-orm'
import { describe, expect } from 'vitest'

import { todoAddedEvent, todoRemovedEvent } from '../../shared'
import { commandScenario, projectionScenario } from '../../shared/test-scenario'
import { todoRemovalStates } from './slice'

describe('removing todos', () => {
  commandScenario(
    'given a saved todo, when it is removed, then it is no longer active',
  )
    .given(todoAddedEvent.create({ todoId: 'todo-1', title: 'Ship it' }))
    .when({ type: 'removeTodo', payload: { todoId: 'todo-1' } })
    .expect((result) =>
      expect(result).toEqual([
        expect.objectContaining({
          id: expect.any(String),
          type: 'todoRemoved',
          payload: { todoId: 'todo-1' },
        }),
      ]),
    )

  commandScenario(
    'given no matching todo, when a todo is removed, then the removal is rejected',
  )
    .given()
    .when({ type: 'removeTodo', payload: { todoId: 'missing' } })
    .throws('Todo not found')

  commandScenario(
    'given an already removed todo, when it is removed again, then the removal is rejected',
  )
    .given(
      todoAddedEvent.create({ todoId: 'todo-1', title: 'Ship it' }),
      todoRemovedEvent.create({ todoId: 'todo-1' }),
    )
    .when({ type: 'removeTodo', payload: { todoId: 'todo-1' } })
    .throws('Todo not found')

  projectionScenario(
    'given a todo was removed before, when removal is read later, then it is still removed',
  )
    .given(
      todoAddedEvent.create({ todoId: 'todo-1', title: 'Ship it' }),
      todoRemovedEvent.create({ todoId: 'todo-1' }),
    )
    .when(({ db }) =>
      db
        .select()
        .from(todoRemovalStates)
        .where(eq(todoRemovalStates.todoId, 'todo-1'))
        .get(),
    )
    .expect((row) => expect(row?.removed).toBe(true))
})
