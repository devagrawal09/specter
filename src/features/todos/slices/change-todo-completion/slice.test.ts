import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { applyEvents, decideCommand } from '../../registry'
import {
  todoAddedEvent,
  todoCompletionChangedEvent,
  todoRemovedEvent,
} from '../../shared'
import { createTestDb } from '../../shared/test-db'
import { todoCompletionStates } from './slice'

describe('change todo completion command slice', () => {
  it('emits a completion changed event from its own state table', () => {
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
          type: 'changeTodoCompletion',
          payload: { todoId: 'todo-1', completed: true },
        },
        db,
      ),
    ).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        type: 'todoCompletionChanged',
        payload: {
          todoId: 'todo-1',
          completed: true,
        },
      }),
    ])

    sqlite.close()
  })

  it('does not emit for same-state completion', () => {
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
      ],
      db,
    )

    expect(
      decideCommand(
        {
          type: 'changeTodoCompletion',
          payload: { todoId: 'todo-1', completed: true },
        },
        db,
      ),
    ).toEqual([])

    sqlite.close()
  })

  it('rejects completing a missing todo', () => {
    const { db, sqlite } = createTestDb()

    expect(() =>
      decideCommand(
        {
          type: 'changeTodoCompletion',
          payload: { todoId: 'missing', completed: true },
        },
        db,
      ),
    ).toThrow('Todo not found')

    sqlite.close()
  })

  it('rejects completing a removed todo', () => {
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
          type: 'changeTodoCompletion',
          payload: { todoId: 'todo-1', completed: true },
        },
        db,
      ),
    ).toThrow('Todo not found')

    sqlite.close()
  })

  it('applies completion state changes from stored events', () => {
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
      ],
      db,
    )

    expect(
      db
        .select()
        .from(todoCompletionStates)
        .where(eq(todoCompletionStates.todoId, 'todo-1'))
        .get(),
    ).toMatchObject({
      todoId: 'todo-1',
      completed: true,
    })

    sqlite.close()
  })
})
