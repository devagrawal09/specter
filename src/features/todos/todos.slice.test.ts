import { describe, expect, it } from 'vitest'

import {
  handleAddTodo,
  handleChangeTodoCompletion,
  handleRemoveTodo,
  projectTodos,
  type TodoEvent,
} from './todos.slice'

const firstDate = new Date('2026-01-01T00:00:00.000Z')
const secondDate = new Date('2026-01-02T00:00:00.000Z')
const thirdDate = new Date('2026-01-03T00:00:00.000Z')

function added(
  todoId: string,
  title: string,
  createdAt = firstDate,
): TodoEvent {
  return {
    type: 'todoAdded',
    payload: { todoId, title, createdAt: createdAt.toISOString() },
  }
}

function completed(todoId: string, updatedAt = secondDate): TodoEvent {
  return {
    type: 'todoCompletionChanged',
    payload: { todoId, completed: true, updatedAt: updatedAt.toISOString() },
  }
}

function removed(todoId: string, removedAt = thirdDate): TodoEvent {
  return {
    type: 'todoRemoved',
    payload: { todoId, removedAt: removedAt.toISOString() },
  }
}

describe('todos slice', () => {
  it('projects an empty view', () => {
    expect(projectTodos([])).toEqual({
      todos: [],
      activeCount: 0,
      completedCount: 0,
      totalCount: 0,
    })
  })

  it('emits a todoAdded event', () => {
    expect(handleAddTodo({ title: 'Ship it' }, firstDate, 'todo-1')).toEqual([
      {
        type: 'todoAdded',
        payload: {
          todoId: 'todo-1',
          title: 'Ship it',
          createdAt: firstDate.toISOString(),
        },
      },
    ])
  })

  it('trims added titles', () => {
    const [event] = handleAddTodo({ title: '  Ship it  ' }, firstDate, 'todo-1')

    expect(event.payload.title).toBe('Ship it')
  })

  it('rejects blank titles', () => {
    expect(() => handleAddTodo({ title: '   ' })).toThrow(
      'Todo title is required',
    )
  })

  it('rejects long titles', () => {
    expect(() => handleAddTodo({ title: 'x'.repeat(121) })).toThrow(
      'Todo title must be 120 characters or less',
    )
  })

  it('emits a completion changed event', () => {
    const state = projectTodos([added('todo-1', 'Ship it')]).todos.map(
      (todo) => ({ ...todo, removedAt: null }),
    )

    expect(
      handleChangeTodoCompletion(
        state,
        { todoId: 'todo-1', completed: true },
        secondDate,
      ),
    ).toEqual([completed('todo-1')])
  })

  it('does not emit for same-state completion', () => {
    const state = projectTodos([
      added('todo-1', 'Ship it'),
      completed('todo-1'),
    ]).todos.map((todo) => ({ ...todo, removedAt: null }))

    expect(
      handleChangeTodoCompletion(state, {
        todoId: 'todo-1',
        completed: true,
      }),
    ).toEqual([])
  })

  it('rejects completing a missing todo', () => {
    expect(() =>
      handleChangeTodoCompletion([], {
        todoId: 'missing',
        completed: true,
      }),
    ).toThrow('Todo not found')
  })

  it('emits a removed event', () => {
    const state = projectTodos([added('todo-1', 'Ship it')]).todos.map(
      (todo) => ({ ...todo, removedAt: null }),
    )

    expect(handleRemoveTodo(state, { todoId: 'todo-1' }, thirdDate)).toEqual([
      removed('todo-1'),
    ])
  })

  it('rejects removing missing or removed todos', () => {
    expect(() => handleRemoveTodo([], { todoId: 'missing' })).toThrow(
      'Todo not found',
    )

    expect(() =>
      handleRemoveTodo(
        [
          {
            id: 'todo-1',
            title: 'Ship it',
            completed: false,
            createdAt: firstDate.toISOString(),
            updatedAt: firstDate.toISOString(),
            removedAt: thirdDate.toISOString(),
          },
        ],
        { todoId: 'todo-1' },
      ),
    ).toThrow('Todo not found')
  })

  it('excludes removed todos', () => {
    const view = projectTodos([
      added('todo-1', 'Removed'),
      removed('todo-1'),
      added('todo-2', 'Visible'),
    ])

    expect(view.todos.map((todo) => todo.id)).toEqual(['todo-2'])
  })

  it('counts visible todos', () => {
    const view = projectTodos([
      added('todo-1', 'Active'),
      added('todo-2', 'Complete'),
      completed('todo-2'),
      added('todo-3', 'Removed'),
      removed('todo-3'),
    ])

    expect(view.totalCount).toBe(2)
    expect(view.activeCount).toBe(1)
    expect(view.completedCount).toBe(1)
  })

  it('orders active before completed and newest first within each group', () => {
    const view = projectTodos([
      added('old-active', 'Old active', firstDate),
      added('complete', 'Complete', secondDate),
      completed('complete', thirdDate),
      added('new-active', 'New active', thirdDate),
    ])

    expect(view.todos.map((todo) => todo.id)).toEqual([
      'new-active',
      'old-active',
      'complete',
    ])
  })

  it('returns filtered views', () => {
    const events = [
      added('todo-1', 'Active'),
      added('todo-2', 'Complete'),
      completed('todo-2'),
    ]

    expect(projectTodos(events, 'active').todos.map((todo) => todo.id)).toEqual(
      ['todo-1'],
    )
    expect(
      projectTodos(events, 'completed').todos.map((todo) => todo.id),
    ).toEqual(['todo-2'])
  })
})
