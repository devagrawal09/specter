import { describe, expect, it } from 'vitest'

import { todoSnapshot } from './shared/todo-test-state'
import { handleTodoCommand, todoCommandInput } from './todos.functions'

describe('todo command dispatcher', () => {
  it('dispatches add todo commands', () => {
    const events = handleTodoCommand([], {
      type: 'addTodo',
      payload: { title: 'Ship it' },
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'todoAdded',
      payload: { title: 'Ship it' },
    })
  })

  it('dispatches completion commands', () => {
    expect(
      handleTodoCommand([todoSnapshot()], {
        type: 'changeTodoCompletion',
        payload: { todoId: 'todo-1', completed: true },
      }),
    ).toMatchObject([
      {
        type: 'todoCompletionChanged',
        payload: { todoId: 'todo-1', completed: true },
      },
    ])
  })

  it('returns no events for unchanged completion commands', () => {
    expect(
      handleTodoCommand([todoSnapshot({ completed: true })], {
        type: 'changeTodoCompletion',
        payload: { todoId: 'todo-1', completed: true },
      }),
    ).toEqual([])
  })

  it('dispatches remove commands', () => {
    expect(
      handleTodoCommand([todoSnapshot()], {
        type: 'removeTodo',
        payload: { todoId: 'todo-1' },
      }),
    ).toMatchObject([
      {
        type: 'todoRemoved',
        payload: { todoId: 'todo-1' },
      },
    ])
  })

  it('rejects commands for missing todos', () => {
    expect(() =>
      handleTodoCommand([], {
        type: 'removeTodo',
        payload: { todoId: 'missing' },
      }),
    ).toThrow('Todo not found')
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
