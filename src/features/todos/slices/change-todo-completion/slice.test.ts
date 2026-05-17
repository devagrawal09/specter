import { eq } from 'drizzle-orm'
import { describe, expect } from 'vitest'

import {
  todoAddedEvent,
  todoCompletionChangedEvent,
  todoRemovedEvent,
} from '../../shared'
import { commandScenario, projectionScenario } from '../../shared/test-scenario'
import { todoCompletionStates } from './slice'

describe('completing todos', () => {
  commandScenario(
    'given a saved todo, when it is completed, then it is marked complete',
  )
    .given(todoAddedEvent.create({ todoId: 'todo-1', title: 'Ship it' }))
    .when({
      type: 'changeTodoCompletion',
      payload: { todoId: 'todo-1', completed: true },
    })
    .expect((result) =>
      expect(result).toEqual([
        expect.objectContaining({
          id: expect.any(String),
          type: 'todoCompletionChanged',
          payload: { todoId: 'todo-1', completed: true },
        }),
      ]),
    )

  commandScenario(
    'given a completed todo, when it is completed again, then nothing changes',
  )
    .given(
      todoAddedEvent.create({ todoId: 'todo-1', title: 'Ship it' }),
      todoCompletionChangedEvent.create({
        todoId: 'todo-1',
        completed: true,
      }),
    )
    .when({
      type: 'changeTodoCompletion',
      payload: { todoId: 'todo-1', completed: true },
    })
    .expect((result) => expect(result).toEqual([]))

  commandScenario(
    'given no matching todo, when a todo is completed, then the change is rejected',
  )
    .given()
    .when({
      type: 'changeTodoCompletion',
      payload: { todoId: 'missing', completed: true },
    })
    .throws('Todo not found')

  commandScenario(
    'given a removed todo, when it is completed, then the change is rejected',
  )
    .given(
      todoAddedEvent.create({ todoId: 'todo-1', title: 'Ship it' }),
      todoRemovedEvent.create({ todoId: 'todo-1' }),
    )
    .when({
      type: 'changeTodoCompletion',
      payload: { todoId: 'todo-1', completed: true },
    })
    .throws('Todo not found')

  projectionScenario(
    'given a todo was completed before, when completion is read later, then it is still complete',
  )
    .given(
      todoAddedEvent.create({ todoId: 'todo-1', title: 'Ship it' }),
      todoCompletionChangedEvent.create({
        todoId: 'todo-1',
        completed: true,
      }),
    )
    .when(({ db }) =>
      db
        .select()
        .from(todoCompletionStates)
        .where(eq(todoCompletionStates.todoId, 'todo-1'))
        .get(),
    )
    .expect((row) =>
      expect(row).toMatchObject({
        todoId: 'todo-1',
        completed: true,
      }),
    )
})
