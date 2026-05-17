import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import {
  firstDate,
  secondDate,
  thirdDate,
  todoAdded,
  todoCompleted,
  todoRemoved,
} from '../../shared/todo-test-events'
import { createTestDb, storedEvent } from '../../shared/test-db'
import {
  applyChangeTodoCompletionEvents,
  decideChangeTodoCompletion,
} from './slice'
import { todoCompletionStates } from './schema'

describe('change todo completion command slice', () => {
  it('emits a completion changed event from its own state table', () => {
    const { db, sqlite } = createTestDb()
    applyChangeTodoCompletionEvents(db, [
      storedEvent(todoAdded('todo-1', 'Ship it'), 1),
    ])

    expect(
      decideChangeTodoCompletion(
        db,
        { todoId: 'todo-1', completed: true },
        secondDate,
      ),
    ).toEqual([
      {
        type: 'todoCompletionChanged',
        payload: {
          todoId: 'todo-1',
          completed: true,
          updatedAt: secondDate.toISOString(),
        },
      },
    ])

    sqlite.close()
  })

  it('does not emit for same-state completion', () => {
    const { db, sqlite } = createTestDb()
    applyChangeTodoCompletionEvents(db, [
      storedEvent(todoAdded('todo-1', 'Ship it'), 1),
      storedEvent(todoCompleted('todo-1'), 2),
    ])

    expect(
      decideChangeTodoCompletion(db, {
        todoId: 'todo-1',
        completed: true,
      }),
    ).toEqual([])

    sqlite.close()
  })

  it('rejects completing a missing todo', () => {
    const { db, sqlite } = createTestDb()

    expect(() =>
      decideChangeTodoCompletion(db, {
        todoId: 'missing',
        completed: true,
      }),
    ).toThrow('Todo not found')

    sqlite.close()
  })

  it('rejects completing a removed todo', () => {
    const { db, sqlite } = createTestDb()
    applyChangeTodoCompletionEvents(db, [
      storedEvent(todoAdded('todo-1', 'Ship it'), 1),
      storedEvent(todoRemoved('todo-1', thirdDate), 2),
    ])

    expect(() =>
      decideChangeTodoCompletion(db, {
        todoId: 'todo-1',
        completed: true,
      }),
    ).toThrow('Todo not found')

    sqlite.close()
  })

  it('applies completion state changes from stored events', () => {
    const { db, sqlite } = createTestDb()
    applyChangeTodoCompletionEvents(db, [
      storedEvent(todoAdded('todo-1', 'Ship it', firstDate), 1),
      storedEvent(todoCompleted('todo-1', secondDate), 2),
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
