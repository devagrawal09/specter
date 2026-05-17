import { describe, expect, it } from 'vitest'

import { applyEvents } from '../../registry'
import {
  todoAddedEvent,
  todoCheerCreatedEvent,
  todoCompletionChangedEvent,
  todoRemovedEvent,
  type StoredEvent,
} from '../../shared'
import { createTestDb, storedEvent } from '../../shared/test-db'
import { todoCompletionCheerReactionSliceRegistration } from './slice'

function completedTodoEvents(count: number): StoredEvent[] {
  return Array.from({ length: count }, (_, index) => {
    const todoId = `todo-${index + 1}`

    return [
      storedEvent(
        todoAddedEvent.create({ todoId, title: todoId }),
        index * 2 + 1,
      ),
      storedEvent(
        todoCompletionChangedEvent.create({ todoId, completed: true }),
        index * 2 + 2,
      ),
    ]
  }).flat()
}

describe('todo completion cheer reaction slice', () => {
  it('emits no command before the fifth completed todo', () => {
    const { db, sqlite } = createTestDb()
    const events = completedTodoEvents(4)
    const lastEvent = events.at(-1)
    applyEvents(events, db)

    if (!lastEvent) {
      throw new Error('Expected completed todo events')
    }

    expect(
      todoCompletionCheerReactionSliceRegistration.react(lastEvent, db),
    ).toEqual([])
    sqlite.close()
  })

  it('emits a cheer command on the fifth completed todo', () => {
    const { db, sqlite } = createTestDb()
    const events = completedTodoEvents(5)
    const lastEvent = events.at(-1)
    applyEvents(events, db)

    if (!lastEvent) {
      throw new Error('Expected completed todo events')
    }

    expect(
      todoCompletionCheerReactionSliceRegistration.react(lastEvent, db),
    ).toEqual([{ type: 'createTodoCheer', payload: { milestone: 5 } }])
    sqlite.close()
  })

  it('does not emit the same milestone after dropping below and reaching it again', () => {
    const { db, sqlite } = createTestDb()
    const events = completedTodoEvents(5)
    applyEvents(
      [
        ...events,
        storedEvent(
          todoCheerCreatedEvent.create({
            milestone: 5,
            message: 'Nice work: 5 todos completed.',
          }),
          11,
        ),
        storedEvent(
          todoCompletionChangedEvent.create({
            todoId: 'todo-5',
            completed: false,
          }),
          12,
        ),
        storedEvent(
          todoCompletionChangedEvent.create({
            todoId: 'todo-5',
            completed: true,
          }),
          13,
        ),
      ],
      db,
    )

    expect(
      todoCompletionCheerReactionSliceRegistration.react(
        storedEvent(
          todoCompletionChangedEvent.create({
            todoId: 'todo-5',
            completed: true,
          }),
          13,
        ),
        db,
      ),
    ).toEqual([])
    sqlite.close()
  })

  it('keeps existing cheer state when completed todos are removed', () => {
    const { db, sqlite } = createTestDb()
    applyEvents(
      [
        ...completedTodoEvents(5),
        storedEvent(
          todoCheerCreatedEvent.create({
            milestone: 5,
            message: 'Nice work: 5 todos completed.',
          }),
          11,
        ),
        storedEvent(todoRemovedEvent.create({ todoId: 'todo-5' }), 12),
      ],
      db,
    )

    expect(
      todoCompletionCheerReactionSliceRegistration.react(
        storedEvent(
          todoCompletionChangedEvent.create({
            todoId: 'todo-4',
            completed: true,
          }),
          13,
        ),
        db,
      ),
    ).toEqual([])
    sqlite.close()
  })
})
