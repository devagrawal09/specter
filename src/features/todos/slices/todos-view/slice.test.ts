import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { applyEvents } from '../../registry'
import {
  todoAddedEvent,
  todoCompletionChangedEvent,
  todoRemovedEvent,
} from '../../shared'
import { createTestDb } from '../../shared/test-db'
import { todoListItems, todosViewQueryInput } from './slice'

describe('todos view projection slice', () => {
  it('applies stored events to its list item table', () => {
    const { db, sqlite } = createTestDb()

    applyEvents(
      [
        {
          ...todoAddedEvent.create({ todoId: 'todo-1', title: 'Ship it' }),
          id: 'event-1',
        },
        {
          ...todoCompletionChangedEvent.create({
            todoId: 'todo-1',
            completed: true,
          }),
          id: 'event-2',
        },
        { ...todoRemovedEvent.create({ todoId: 'todo-1' }), id: 'event-3' },
      ],
      db,
    )

    const row = db
      .select()
      .from(todoListItems)
      .where(eq(todoListItems.id, 'todo-1'))
      .get()

    expect(row).toMatchObject({
      id: 'todo-1',
      title: 'Ship it',
      completed: true,
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
