import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { applyEvents } from '../../registry'
import {
  todoAddedEvent,
  todoCheerCreatedEvent,
  todoCompletionChangedEvent,
  todoRemovedEvent,
  type Event,
} from '../../shared'
import { createTestDb } from '../../shared/test-db'
import {
  todoCompletionCheerReactionSliceRegistration,
  todoCompletionCheerTodoStates,
} from './slice'

function completedTodoEvents(count: number): Event[] {
  return Array.from({ length: count }, (_, index) => {
    const todoId = `todo-${index + 1}`

    return [
      {
        ...todoAddedEvent.create({ todoId, title: todoId }),
        id: `event-${index * 2 + 1}`,
      },
      {
        ...todoCompletionChangedEvent.create({ todoId, completed: true }),
        id: `event-${index * 2 + 2}`,
      },
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

  it('applies completion state to its own read model', () => {
    const { db, sqlite } = createTestDb()
    applyEvents(completedTodoEvents(1), db)

    const row = db
      .select()
      .from(todoCompletionCheerTodoStates)
      .where(eq(todoCompletionCheerTodoStates.todoId, 'todo-1'))
      .get()

    expect(row).toMatchObject({
      todoId: 'todo-1',
      completed: true,
      removed: false,
    })
    sqlite.close()
  })

  it('does not emit the same milestone after dropping below and reaching it again', () => {
    const { db, sqlite } = createTestDb()
    const events = completedTodoEvents(5)
    applyEvents(
      [
        ...events,
        {
          ...todoCheerCreatedEvent.create({
            milestone: 5,
            message: 'Nice work: 5 todos completed.',
          }),
          id: 'event-11',
        },
        {
          ...todoCompletionChangedEvent.create({
            todoId: 'todo-5',
            completed: false,
          }),
          id: 'event-12',
        },
        {
          ...todoCompletionChangedEvent.create({
            todoId: 'todo-5',
            completed: true,
          }),
          id: 'event-13',
        },
      ],
      db,
    )

    expect(
      todoCompletionCheerReactionSliceRegistration.react(
        {
          ...todoCompletionChangedEvent.create({
            todoId: 'todo-5',
            completed: true,
          }),
          id: 'event-13',
        },
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
        {
          ...todoCheerCreatedEvent.create({
            milestone: 5,
            message: 'Nice work: 5 todos completed.',
          }),
          id: 'event-11',
        },
        { ...todoRemovedEvent.create({ todoId: 'todo-5' }), id: 'event-12' },
      ],
      db,
    )

    expect(
      todoCompletionCheerReactionSliceRegistration.react(
        {
          ...todoCompletionChangedEvent.create({
            todoId: 'todo-4',
            completed: true,
          }),
          id: 'event-13',
        },
        db,
      ),
    ).toEqual([])
    sqlite.close()
  })
})
