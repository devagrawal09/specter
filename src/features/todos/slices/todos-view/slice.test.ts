import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { applyEvents } from '../../registry'
import { todoAdded, todoCompleted, todoRemoved } from '../../shared'
import { createTestDb, storedEvent } from '../../shared/test-db'
import { todoListItems, todosViewQueryInput } from './model'

describe('todos view projection slice', () => {
  it('applies stored events to its list item table', () => {
    const { db, sqlite } = createTestDb()

    applyEvents(db, [
      storedEvent(todoAdded('todo-1', 'Ship it'), 1),
      storedEvent(todoCompleted('todo-1'), 2),
      storedEvent(todoRemoved('todo-1'), 3),
    ])

    const row = db
      .select()
      .from(todoListItems)
      .where(eq(todoListItems.id, 'todo-1'))
      .get()

    expect(row).toMatchObject({
      id: 'todo-1',
      title: 'Ship it',
      completed: true,
      lastAppliedEventId: 3,
    })
    expect(row?.removed).toBe(true)

    sqlite.close()
  })

  it('parses query statuses', () => {
    expect(todosViewQueryInput.parse({ status: 'active' })).toEqual({
      status: 'active',
    })
    expect(todosViewQueryInput.parse({ status: 'wat' })).toEqual({
      status: 'all',
    })
    expect(todosViewQueryInput.parse({})).toEqual({ status: 'all' })
  })
})
