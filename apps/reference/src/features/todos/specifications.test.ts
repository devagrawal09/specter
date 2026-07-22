import { digestSpecification } from '@specter-ts/spec'
import { describe, expect, it } from 'vitest'

import { todoSpecificationDigests, todoSpecifications } from './specifications'

describe('Todo observability specifications', () => {
  it('publishes every registered Slice with its canonical digest', () => {
    expect(
      todoSpecifications.map((specification) => specification.name),
    ).toEqual([
      'addTodo',
      'changeTodoCompletion',
      'createTodoCheer',
      'removeTodo',
      'todoCheers',
      'todoCompletionCheer',
      'todosQuery',
    ])
    for (const specification of todoSpecifications) {
      expect(todoSpecificationDigests[specification.name]).toBe(
        digestSpecification(specification),
      )
    }
  })
})
