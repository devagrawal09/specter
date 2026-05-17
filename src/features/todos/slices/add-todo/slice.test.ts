import { describe, expect, it } from 'vitest'

import { firstDate } from '../../shared/todo-test-events'
import { handleAddTodo } from './slice'

const todoId = '00000000-0000-4000-8000-000000000001'

describe('add todo command slice', () => {
  it('emits a todoAdded event', () => {
    expect(handleAddTodo({ title: 'Ship it' }, firstDate, todoId)).toEqual([
      {
        type: 'todoAdded',
        payload: {
          todoId,
          title: 'Ship it',
          createdAt: firstDate.toISOString(),
        },
      },
    ])
  })

  it('trims added titles', () => {
    const [event] = handleAddTodo({ title: '  Ship it  ' }, firstDate, todoId)

    if (event.type !== 'todoAdded') {
      throw new Error(`Expected todoAdded event, received ${event.type}`)
    }

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
