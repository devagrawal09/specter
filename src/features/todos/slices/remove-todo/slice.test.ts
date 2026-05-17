import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { applyEvents, decideCommand } from '../../registry'
import { todoAdded, todoRemoved } from '../../shared'
import { createTestDb, storedEvent } from '../../shared/test-db'
import { todoRemovalStates } from './schema'

describe('remove todo command slice', () => {
  it('emits a removed event from its own state table', () => {
    const { db, sqlite } = createTestDb()
    applyEvents(db, [storedEvent(todoAdded('todo-1', 'Ship it'), 1)])

    expect(
      decideCommand(db, {
        type: 'removeTodo',
        payload: { todoId: 'todo-1' },
      }),
    ).toEqual([
      {
        type: 'todoRemoved',
        payload: { todoId: 'todo-1' },
      },
    ])

    sqlite.close()
  })

  it('rejects removing a missing todo', () => {
    const { db, sqlite } = createTestDb()

    expect(() =>
      decideCommand(db, {
        type: 'removeTodo',
        payload: { todoId: 'missing' },
      }),
    ).toThrow('Todo not found')

    sqlite.close()
  })

  it('rejects removing an already removed todo', () => {
    const { db, sqlite } = createTestDb()
    applyEvents(db, [
      storedEvent(todoAdded('todo-1', 'Ship it'), 1),
      storedEvent(todoRemoved('todo-1'), 2),
    ])

    expect(() =>
      decideCommand(db, {
        type: 'removeTodo',
        payload: { todoId: 'todo-1' },
      }),
    ).toThrow('Todo not found')

    sqlite.close()
  })

  it('applies removal state from stored events', () => {
    const { db, sqlite } = createTestDb()
    applyEvents(db, [
      storedEvent(todoAdded('todo-1', 'Ship it'), 1),
      storedEvent(todoRemoved('todo-1'), 2),
    ])

    const row = db
      .select()
      .from(todoRemovalStates)
      .where(eq(todoRemovalStates.todoId, 'todo-1'))
      .get()

    expect(row?.removed).toBe(true)
    expect(row?.lastAppliedEventId).toBe(2)

    sqlite.close()
  })
})
