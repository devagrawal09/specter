import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { createTestDb, storedEvent } from '../../shared/test-db'
import { todoAdded, todoCompleted, todoRemoved } from '../../shared'
import { mutateTodoListItemsFromEvents } from './slice'
import { todoListItems } from './slice'

describe('todos view projection slice', () => {
  it('applies stored events to its list item table', () => {
    const { db, sqlite } = createTestDb()

    mutateTodoListItemsFromEvents(db, [
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
})
