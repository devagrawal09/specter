import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { applyEvents, decideCommand } from '../../registry'
import { todoAdded, todoCompleted, todoRemoved } from '../../shared'
import { createTestDb, storedEvent } from '../../shared/test-db'
import { todoCompletionStates } from './schema'

describe('change todo completion command slice', () => {
  it('emits a completion changed event from its own state table', () => {
    const { db, sqlite } = createTestDb()
    applyEvents(db, [storedEvent(todoAdded('todo-1', 'Ship it'), 1)])

    expect(
      decideCommand(db, {
        type: 'changeTodoCompletion',
        payload: { todoId: 'todo-1', completed: true },
      }),
    ).toEqual([
      {
        type: 'todoCompletionChanged',
        payload: {
          todoId: 'todo-1',
          completed: true,
        },
      },
    ])

    sqlite.close()
  })

  it('does not emit for same-state completion', () => {
    const { db, sqlite } = createTestDb()
    applyEvents(db, [
      storedEvent(todoAdded('todo-1', 'Ship it'), 1),
      storedEvent(todoCompleted('todo-1'), 2),
    ])

    expect(
      decideCommand(db, {
        type: 'changeTodoCompletion',
        payload: { todoId: 'todo-1', completed: true },
      }),
    ).toEqual([])

    sqlite.close()
  })

  it('rejects completing a missing todo', () => {
    const { db, sqlite } = createTestDb()

    expect(() =>
      decideCommand(db, {
        type: 'changeTodoCompletion',
        payload: { todoId: 'missing', completed: true },
      }),
    ).toThrow('Todo not found')

    sqlite.close()
  })

  it('rejects completing a removed todo', () => {
    const { db, sqlite } = createTestDb()
    applyEvents(db, [
      storedEvent(todoAdded('todo-1', 'Ship it'), 1),
      storedEvent(todoRemoved('todo-1'), 2),
    ])

    expect(() =>
      decideCommand(db, {
        type: 'changeTodoCompletion',
        payload: { todoId: 'todo-1', completed: true },
      }),
    ).toThrow('Todo not found')

    sqlite.close()
  })

  it('applies completion state changes from stored events', () => {
    const { db, sqlite } = createTestDb()
    applyEvents(db, [
      storedEvent(todoAdded('todo-1', 'Ship it'), 1),
      storedEvent(todoCompleted('todo-1'), 2),
    ])

    expect(
      db
        .select()
        .from(todoCompletionStates)
        .where(eq(todoCompletionStates.todoId, 'todo-1'))
        .get(),
    ).toMatchObject({
      todoId: 'todo-1',
      completed: true,
      lastAppliedEventId: 2,
    })

    sqlite.close()
  })
})
