import { describe, expect, it } from 'vitest'

import { firstDate } from '../../shared/todo-test-events'
import { handleAddTodo } from './add-todo.slice'

describe('add todo command slice', () => {
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
})
