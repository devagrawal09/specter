import { eq } from 'drizzle-orm'
import { describe, expect } from 'vitest'

import {
  todoAddedEvent,
  todoCheerCreatedEvent,
  todoCompletionChangedEvent,
  todoRemovedEvent,
  type Event,
} from '../../shared'
import {
  projectionScenario,
  reactionScenario,
} from '../../shared/test-scenario'
import {
  todoCompletionCheerReactionSliceRegistration,
  todoCompletionCheerTodoStates,
} from './slice'

function completedTodoEvents(count: number): Event[] {
  return Array.from({ length: count }, (_, index) => {
    const todoId = `todo-${index + 1}`

    return [
      todoAddedEvent.create({ todoId, title: todoId }),
      todoCompletionChangedEvent.create({ todoId, completed: true }),
    ]
  }).flat()
}

describe('requesting cheers for completed todos', () => {
  reactionScenario(
    'given four completed todos, when the latest completion is observed, then no cheer is requested',
  )
    .given(...completedTodoEvents(4))
    .whenLastGivenEvent(todoCompletionCheerReactionSliceRegistration)
    .expect((result) => expect(result).toEqual([]))

  reactionScenario(
    'given five completed todos, when the latest completion is observed, then a cheer is requested',
  )
    .given(...completedTodoEvents(5))
    .whenLastGivenEvent(todoCompletionCheerReactionSliceRegistration)
    .expect((result) =>
      expect(result).toEqual([
        { type: 'createTodoCheer', payload: { milestone: 5 } },
      ]),
    )

  projectionScenario(
    'given a todo was completed before, when cheer progress is read later, then the todo still counts as complete',
  )
    .given(...completedTodoEvents(1))
    .when(({ db }) =>
      db
        .select()
        .from(todoCompletionCheerTodoStates)
        .where(eq(todoCompletionCheerTodoStates.todoId, 'todo-1'))
        .get(),
    )
    .expect((row) =>
      expect(row).toMatchObject({
        todoId: 'todo-1',
        completed: true,
        removed: false,
      }),
    )

  reactionScenario(
    'given a milestone was already celebrated, when the count drops and reaches it again, then no duplicate cheer is requested',
  )
    .given(
      ...completedTodoEvents(5),
      todoCheerCreatedEvent.create({
        milestone: 5,
        message: 'Nice work: 5 todos completed.',
      }),
      todoCompletionChangedEvent.create({
        todoId: 'todo-5',
        completed: false,
      }),
      todoCompletionChangedEvent.create({
        todoId: 'todo-5',
        completed: true,
      }),
    )
    .when(
      todoCompletionCheerReactionSliceRegistration,
      todoCompletionChangedEvent.create({
        todoId: 'todo-5',
        completed: true,
      }),
    )
    .expect((result) => expect(result).toEqual([]))

  reactionScenario(
    'given a milestone was already celebrated, when completed todos are removed, then no duplicate cheer is requested',
  )
    .given(
      ...completedTodoEvents(5),
      todoCheerCreatedEvent.create({
        milestone: 5,
        message: 'Nice work: 5 todos completed.',
      }),
      todoRemovedEvent.create({ todoId: 'todo-5' }),
    )
    .when(
      todoCompletionCheerReactionSliceRegistration,
      todoCompletionChangedEvent.create({
        todoId: 'todo-4',
        completed: true,
      }),
    )
    .expect((result) => expect(result).toEqual([]))
})
