import { describe, expect, it } from 'vitest'

import { secondDate } from '../../shared/todo-test-events'
import { todoSnapshot } from '../../shared/todo-test-state'
import { handleChangeTodoCompletion } from './change-todo-completion.slice'

describe('change todo completion command slice', () => {
  it('emits a completion changed event', () => {
    expect(
      handleChangeTodoCompletion(
        [todoSnapshot()],
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
  })

  it('does not emit for same-state completion', () => {
    expect(
      handleChangeTodoCompletion([todoSnapshot({ completed: true })], {
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

  it('rejects completing a removed todo', () => {
    expect(() =>
      handleChangeTodoCompletion(
        [todoSnapshot({ removedAt: '2026-01-03T00:00:00.000Z' })],
        { todoId: 'todo-1', completed: true },
      ),
    ).toThrow('Todo not found')
  })
})
