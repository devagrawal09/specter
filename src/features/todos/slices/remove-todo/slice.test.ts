import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { applyEvents, decideCommand } from '../../registry'
import { todoAddedEvent, todoRemovedEvent } from '../../shared'
import { createTestDb } from '../../shared/test-db'
import { todoRemovalStates } from './slice'

describe('remove todo command slice', () => {
  it('emits a removed event from its own state table', () => {
    const { db, sqlite } = createTestDb()
    applyEvents(
      [
        {
          ...todoAddedEvent.create({ todoId: 'todo-1', title: 'Ship it' }),
          id: 'event-1',
        },
      ],
      db,
    )

    expect(
      decideCommand(
        {
          type: 'removeTodo',
          payload: { todoId: 'todo-1' },
        },
        db,
      ),
    ).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        type: 'todoRemoved',
        payload: { todoId: 'todo-1' },
      }),
    ])

    sqlite.close()
  })

  it('rejects removing a missing todo', () => {
    const { db, sqlite } = createTestDb()

    expect(() =>
      decideCommand(
        {
          type: 'removeTodo',
          payload: { todoId: 'missing' },
        },
        db,
      ),
    ).toThrow('Todo not found')

    sqlite.close()
  })

  it('rejects removing an already removed todo', () => {
    const { db, sqlite } = createTestDb()
    applyEvents(
      [
        {
          ...todoAddedEvent.create({ todoId: 'todo-1', title: 'Ship it' }),
          id: 'event-1',
        },
        { ...todoRemovedEvent.create({ todoId: 'todo-1' }), id: 'event-2' },
      ],
      db,
    )

    expect(() =>
      decideCommand(
        {
          type: 'removeTodo',
          payload: { todoId: 'todo-1' },
        },
        db,
      ),
    ).toThrow('Todo not found')

    sqlite.close()
  })

  it('applies removal state from stored events', () => {
    const { db, sqlite } = createTestDb()
    applyEvents(
      [
        {
          ...todoAddedEvent.create({ todoId: 'todo-1', title: 'Ship it' }),
          id: 'event-1',
        },
        { ...todoRemovedEvent.create({ todoId: 'todo-1' }), id: 'event-2' },
      ],
      db,
    )

    const row = db
      .select()
      .from(todoRemovalStates)
      .where(eq(todoRemovalStates.todoId, 'todo-1'))
      .get()

    expect(row?.removed).toBe(true)

    sqlite.close()
  })
})
