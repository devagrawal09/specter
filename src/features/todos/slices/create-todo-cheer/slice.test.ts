import { describe, expect, it } from 'vitest'

import { applyEvents, decideCommand } from '../../registry'
import {
  todoAddedEvent,
  todoCheerCreatedEvent,
  todoCompletionChangedEvent,
} from '../../shared'
import { createTestDb } from '../../shared/test-db'

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
})
