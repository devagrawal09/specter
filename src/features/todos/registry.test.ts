import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import {
  applyEvents,
  commandInput,
  decideCommand,
  sliceRegistrations,
} from './registry'
import { todoAddedEvent } from './shared'
import { createTestDb, storedEvent } from './shared/test-db'
import { todoCompletionStates } from './slices/change-todo-completion/slice'
import { todoRemovalStates } from './slices/remove-todo/slice'
import { todoListItems } from './slices/todos-view/slice'

describe('todo registry', () => {
  it('builds command input from registered command slices', () => {
    expect(
      commandInput.parse({
        type: 'addTodo',
        payload: { title: 'Ship it' },
      }),
    ).toEqual({
      type: 'addTodo',
      payload: { title: 'Ship it' },
    })

    expect(() =>
      commandInput.parse({
        type: 'missingCommand',
        payload: {},
      }),
    ).toThrow()
  })

  it('routes decisions by command type', () => {
    const { db, sqlite } = createTestDb()
    const [event] = decideCommand(
      {
        type: 'addTodo',
        payload: { title: 'Route me' },
      },
      db,
    )

    expect(event).toMatchObject({
      type: 'todoAdded',
      payload: { title: 'Route me' },
    })
    sqlite.close()
  })

  it('applies command state and projection state in registration order', () => {
    const { db, sqlite } = createTestDb()

    applyEvents(
      [
        storedEvent(
          todoAddedEvent.create({ todoId: 'todo-1', title: 'Ship it' }),
          1,
        ),
      ],
      db,
    )

    expect(
      db
        .select()
        .from(todoCompletionStates)
        .where(eq(todoCompletionStates.todoId, 'todo-1'))
        .get(),
    ).toMatchObject({ todoId: 'todo-1', lastAppliedEventId: 1 })
    expect(
      db
        .select()
        .from(todoRemovalStates)
        .where(eq(todoRemovalStates.todoId, 'todo-1'))
        .get(),
    ).toMatchObject({ todoId: 'todo-1', lastAppliedEventId: 1 })
    expect(
      db
        .select()
        .from(todoListItems)
        .where(eq(todoListItems.id, 'todo-1'))
        .get(),
    ).toMatchObject({ id: 'todo-1', title: 'Ship it', lastAppliedEventId: 1 })
    sqlite.close()
  })

  it('uses clean fluent registration shapes', () => {
    expect(sliceRegistrations.map((slice) => slice.kind)).toEqual([
      'command',
      'command',
      'command',
      'projection',
    ])
    expect(sliceRegistrations[0]).not.toHaveProperty('payload')
    expect(sliceRegistrations[0]).toHaveProperty('schema')
  })
})
