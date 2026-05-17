import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import {
  thirdDate,
  todoAdded,
  todoRemoved,
} from '../../shared/todo-test-events'
import { createTestDb, storedEvent } from '../../shared/test-db'
import { applyRemoveTodoEvents, decideRemoveTodo } from './slice'
import { todoRemovalStates } from './schema'

describe('remove todo command slice', () => {
  it('emits a removed event from its own state table', () => {
    const { db, sqlite } = createTestDb()
    applyRemoveTodoEvents(db, [storedEvent(todoAdded('todo-1', 'Ship it'), 1)])

    expect(decideRemoveTodo(db, { todoId: 'todo-1' }, thirdDate)).toEqual([
      {
        type: 'todoRemoved',
        payload: { todoId: 'todo-1', removedAt: thirdDate.toISOString() },
      },
    ])

    sqlite.close()
  })

  it('rejects removing a missing todo', () => {
    const { db, sqlite } = createTestDb()

    expect(() => decideRemoveTodo(db, { todoId: 'missing' })).toThrow(
      'Todo not found',
    )

    sqlite.close()
  })

  it('rejects removing an already removed todo', () => {
    const { db, sqlite } = createTestDb()
    applyRemoveTodoEvents(db, [
      storedEvent(todoAdded('todo-1', 'Ship it'), 1),
      storedEvent(todoRemoved('todo-1'), 2),
    ])

    expect(() => decideRemoveTodo(db, { todoId: 'todo-1' })).toThrow(
      'Todo not found',
    )

    sqlite.close()
  })

  it('applies removal state from stored events', () => {
    const { db, sqlite } = createTestDb()
    applyRemoveTodoEvents(db, [
      storedEvent(todoAdded('todo-1', 'Ship it'), 1),
      storedEvent(todoRemoved('todo-1'), 2),
    ])

    const row = db
      .select()
      .from(todoRemovalStates)
      .where(eq(todoRemovalStates.todoId, 'todo-1'))
      .get()

    expect(row?.removedAt?.toISOString()).toBe(thirdDate.toISOString())
    expect(row?.lastAppliedEventId).toBe(2)

    sqlite.close()
  })
})
