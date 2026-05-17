import { describe, expect, it } from 'vitest'

import { thirdDate } from '../../shared/todo-test-events'
import { todoSnapshot } from '../../shared/todo-test-state'
import { handleRemoveTodo } from './remove-todo.slice'

describe('remove todo command slice', () => {
  it('emits a removed event', () => {
    expect(
      handleRemoveTodo([todoSnapshot()], { todoId: 'todo-1' }, thirdDate),
    ).toEqual([
      {
        type: 'todoRemoved',
        payload: { todoId: 'todo-1', removedAt: thirdDate.toISOString() },
      },
    ])
  })

  it('rejects removing missing or removed todos', () => {
    expect(() => handleRemoveTodo([], { todoId: 'missing' })).toThrow(
      'Todo not found',
    )

    expect(() =>
      handleRemoveTodo([todoSnapshot({ removedAt: thirdDate.toISOString() })], {
        todoId: 'todo-1',
      }),
    ).toThrow('Todo not found')
  })
})
