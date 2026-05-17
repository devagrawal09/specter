import { describe, expect, it } from 'vitest'

import {
  todoAdded,
  todoCompleted,
  todoRemoved,
  firstDate,
  secondDate,
  thirdDate,
} from '../../shared/todo-test-events'
import { projectTodos } from './todos-view.slice'

describe('todos view projection slice', () => {
  it('projects an empty view', () => {
    expect(projectTodos([])).toEqual({
      todos: [],
      activeCount: 0,
      completedCount: 0,
      totalCount: 0,
    })
  })

  it('excludes removed todos', () => {
    const view = projectTodos([
      todoAdded('todo-1', 'Removed'),
      todoRemoved('todo-1'),
      todoAdded('todo-2', 'Visible'),
    ])

    expect(view.todos.map((todo) => todo.id)).toEqual(['todo-2'])
  })

  it('counts visible todos', () => {
    const view = projectTodos([
      todoAdded('todo-1', 'Active'),
      todoAdded('todo-2', 'Complete'),
      todoCompleted('todo-2'),
      todoAdded('todo-3', 'Removed'),
      todoRemoved('todo-3'),
    ])

    expect(view.totalCount).toBe(2)
    expect(view.activeCount).toBe(1)
    expect(view.completedCount).toBe(1)
  })

  it('orders active before completed and newest first within each group', () => {
    const view = projectTodos([
      todoAdded('old-active', 'Old active', firstDate),
      todoAdded('complete', 'Complete', secondDate),
      todoCompleted('complete', thirdDate),
      todoAdded('new-active', 'New active', thirdDate),
    ])

    expect(view.todos.map((todo) => todo.id)).toEqual([
      'new-active',
      'old-active',
      'complete',
    ])
  })

  it('returns filtered views', () => {
    const events = [
      todoAdded('todo-1', 'Active'),
      todoAdded('todo-2', 'Complete'),
      todoCompleted('todo-2'),
    ]

    expect(projectTodos(events, 'active').todos.map((todo) => todo.id)).toEqual(
      ['todo-1'],
    )
    expect(
      projectTodos(events, 'completed').todos.map((todo) => todo.id),
    ).toEqual(['todo-2'])
  })
})
