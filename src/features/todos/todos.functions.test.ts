import { describe, expect, it } from 'vitest'

import { applyChangeTodoCompletionEvents } from './slices/change-todo-completion/slice'
import { applyRemoveTodoEvents } from './slices/remove-todo/slice'
import { todoAdded, todoCompleted } from './shared/todo-test-events'
import { createTestDb, storedEvent } from './shared/test-db'
import { decideTodoCommand, todoCommandInput } from './todos.functions'

describe('todo command dispatcher', () => {
  it('dispatches add todo commands without shared state', () => {
    const { db, sqlite } = createTestDb()
    const events = decideTodoCommand(db, {
      type: 'addTodo',
      payload: { title: 'Ship it' },
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'todoAdded',
      payload: { title: 'Ship it' },
    })

    sqlite.close()
  })

  it('dispatches completion commands through the completion slice table', () => {
    const { db, sqlite } = createTestDb()
    applyChangeTodoCompletionEvents(db, [
      storedEvent(todoAdded('todo-1', 'Ship it'), 1),
    ])

    expect(
      decideTodoCommand(db, {
        type: 'changeTodoCompletion',
        payload: { todoId: 'todo-1', completed: true },
      }),
    ).toMatchObject([
      {
        type: 'todoCompletionChanged',
        payload: { todoId: 'todo-1', completed: true },
      },
    ])

    sqlite.close()
  })

  it('returns no events for unchanged completion commands', () => {
    const { db, sqlite } = createTestDb()
    applyChangeTodoCompletionEvents(db, [
      storedEvent(todoAdded('todo-1', 'Ship it'), 1),
      storedEvent(todoCompleted('todo-1'), 2),
    ])

    expect(
      decideTodoCommand(db, {
        type: 'changeTodoCompletion',
        payload: { todoId: 'todo-1', completed: true },
      }),
    ).toEqual([])

    sqlite.close()
  })

  it('dispatches remove commands through the removal slice table', () => {
    const { db, sqlite } = createTestDb()
    applyRemoveTodoEvents(db, [storedEvent(todoAdded('todo-1', 'Ship it'), 1)])

    expect(
      decideTodoCommand(db, {
        type: 'removeTodo',
        payload: { todoId: 'todo-1' },
      }),
    ).toMatchObject([
      {
        type: 'todoRemoved',
        payload: { todoId: 'todo-1' },
      },
    ])

    sqlite.close()
  })

  it('rejects commands for missing todos', () => {
    const { db, sqlite } = createTestDb()

    expect(() =>
      decideTodoCommand(db, {
        type: 'removeTodo',
        payload: { todoId: 'missing' },
      }),
    ).toThrow('Todo not found')

    sqlite.close()
  })

  it('validates supported command shapes', () => {
    expect(
      todoCommandInput.safeParse({
        type: 'addTodo',
        payload: { title: 'Ship it' },
      }).success,
    ).toBe(true)

    expect(
      todoCommandInput.safeParse({
        type: 'archiveTodo',
        payload: { todoId: 'todo-1' },
      }).success,
    ).toBe(false)

    expect(
      todoCommandInput.safeParse({
        type: 'removeTodo',
        payload: {},
      }).success,
    ).toBe(false)
  })
})
