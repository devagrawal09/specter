import { eq } from 'drizzle-orm'
import { describe, expect } from 'vitest'

import {
  todoAddedEvent,
  todoCheerCreatedEvent,
  todoCompletionChangedEvent,
  todoRemovedEvent,
} from '../../shared'
import { commandScenario, projectionScenario } from '../../shared/test-scenario'
import { createTodoCheerTodoStates } from './slice'

function completedTodoEvents(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const todoId = `todo-${index + 1}`

    return [
      todoAddedEvent.create({ todoId, title: todoId }),
      todoCompletionChangedEvent.create({ todoId, completed: true }),
    ]
  }).flat()
}

describe('celebrating completed todos', () => {
  commandScenario(
    'given a milestone that is not a multiple of five, when a cheer is requested, then the milestone is rejected',
  )
    .given()
    .when({ type: 'createTodoCheer', payload: { milestone: 4 } })
    .throws('Todo cheer milestone must be a multiple of 5')

  commandScenario(
    'given fewer completed todos than the milestone, when a cheer is requested, then the milestone is rejected',
  )
    .given(...completedTodoEvents(4))
    .when({ type: 'createTodoCheer', payload: { milestone: 5 } })
    .throws('Todo cheer milestone has not been reached')

  commandScenario(
    'given a milestone already has a cheer, when a cheer is requested again, then it is rejected',
  )
    .given(
      ...completedTodoEvents(5),
      todoCheerCreatedEvent.create({
        milestone: 5,
        message: 'Nice work: 5 todos completed.',
      }),
    )
    .when({ type: 'createTodoCheer', payload: { milestone: 5 } })
    .throws('Todo cheer milestone already exists')

  commandScenario(
    'given five completed todos, when a cheer is requested, then a cheer is created for that milestone',
  )
    .given(...completedTodoEvents(5))
    .when({ type: 'createTodoCheer', payload: { milestone: 5 } })
    .expect((result) =>
      expect(result).toEqual([
        expect.objectContaining({
          id: expect.any(String),
          type: 'todoCheerCreated',
          payload: {
            milestone: 5,
            message: 'Nice work: 5 todos completed.',
          },
        }),
      ]),
    )

  projectionScenario(
    'given a todo was completed before, when cheer progress is read later, then the todo still counts as complete',
  )
    .given(...completedTodoEvents(1))
    .when(({ db }) =>
      db
        .select()
        .from(createTodoCheerTodoStates)
        .where(eq(createTodoCheerTodoStates.todoId, 'todo-1'))
        .get(),
    )
    .expect((row) =>
      expect(row).toMatchObject({
        todoId: 'todo-1',
        completed: true,
        removed: false,
      }),
    )

  commandScenario(
    'given one of five completed todos was removed, when a cheer is requested, then the milestone is not reached',
  )
    .given(
      ...completedTodoEvents(5),
      todoRemovedEvent.create({ todoId: 'todo-5' }),
    )
    .when({ type: 'createTodoCheer', payload: { milestone: 5 } })
    .throws('Todo cheer milestone has not been reached')
})
