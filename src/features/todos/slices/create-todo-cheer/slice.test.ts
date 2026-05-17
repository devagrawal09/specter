import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { applyEvents, decideCommand } from '../../registry'
import {
  todoAddedEvent,
  todoCheerCreatedEvent,
  todoCompletionChangedEvent,
  todoRemovedEvent,
} from '../../shared'
import { createTestDb } from '../../shared/test-db'
import { createTodoCheerTodoStates } from './slice'

function applyCompletedTodos(
  count: number,
  db: ReturnType<typeof createTestDb>['db'],
) {
  applyEvents(
    Array.from({ length: count }, (_, index) => {
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
    }).flat(),
    db,
  )
}

describe('create todo cheer command slice', () => {
  it('rejects milestones that are not multiples of five', () => {
    const { db, sqlite } = createTestDb()

    expect(() =>
      decideCommand({ type: 'createTodoCheer', payload: { milestone: 4 } }, db),
    ).toThrow('Todo cheer milestone must be a multiple of 5')
    sqlite.close()
  })

  it('rejects milestones above the current completed count', () => {
    const { db, sqlite } = createTestDb()
    applyCompletedTodos(4, db)

    expect(() =>
      decideCommand({ type: 'createTodoCheer', payload: { milestone: 5 } }, db),
    ).toThrow('Todo cheer milestone has not been reached')
    sqlite.close()
  })

  it('rejects milestones that already have a cheer', () => {
    const { db, sqlite } = createTestDb()
    applyCompletedTodos(5, db)
    applyEvents(
      [
        {
          ...todoCheerCreatedEvent.create({
            milestone: 5,
            message: 'Nice work: 5 todos completed.',
          }),
          id: 'event-11',
        },
      ],
      db,
    )

    expect(() =>
      decideCommand({ type: 'createTodoCheer', payload: { milestone: 5 } }, db),
    ).toThrow('Todo cheer milestone already exists')
    sqlite.close()
  })

  it('creates a server-generated cheer event for a reached milestone', () => {
    const { db, sqlite } = createTestDb()
    applyCompletedTodos(5, db)

    expect(
      decideCommand({ type: 'createTodoCheer', payload: { milestone: 5 } }, db),
    ).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        type: 'todoCheerCreated',
        payload: {
          milestone: 5,
          message: 'Nice work: 5 todos completed.',
        },
      }),
    ])
    sqlite.close()
  })

  it('applies completion state to its own read model', () => {
    const { db, sqlite } = createTestDb()
    applyCompletedTodos(1, db)

    const row = db
      .select()
      .from(createTodoCheerTodoStates)
      .where(eq(createTodoCheerTodoStates.todoId, 'todo-1'))
      .get()

    expect(row).toMatchObject({
      todoId: 'todo-1',
      completed: true,
      removed: false,
    })
    sqlite.close()
  })

  it('ignores removed todos when validating a reached milestone', () => {
    const { db, sqlite } = createTestDb()
    applyCompletedTodos(5, db)
    applyEvents(
      [
        {
          ...todoRemovedEvent.create({ todoId: 'todo-5' }),
          id: 'event-11',
        },
      ],
      db,
    )

    expect(() =>
      decideCommand({ type: 'createTodoCheer', payload: { milestone: 5 } }, db),
    ).toThrow('Todo cheer milestone has not been reached')
    sqlite.close()
  })
})
