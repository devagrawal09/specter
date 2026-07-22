import { createCommandSlice, event } from '@specter-ts/spec'
import { describe, expect, it } from 'vitest'
import { implementCommand, implementQuery } from './builders'

const commandJson = JSON.stringify(
  createCommandSlice('addTodo')
    .description('Adds a todo.')
    .scenarios({
      description: 'Adds one.',
      given: [],
      when: { id: 'todo-1' },
      expect: [event('todo-added', { id: 'todo-1' })],
    }),
)

describe('JSON-only implementation builders', () => {
  it('loads raw JSON text and preserves an explicit literal Slice name type', () => {
    const implementation = implementCommand<'addTodo'>(commandJson)
    const name: 'addTodo' = implementation.name
    expect(name).toBe('addTodo')
    expect(implementation.scenarios[0]?.expect[0]).toEqual({
      kind: 'scenario-event',
      eventType: 'todo-added',
      examplePayload: { id: 'todo-1' },
    })
  })

  it('rejects a mismatched kind', () => {
    expect(() => implementQuery(commandJson)).toThrow(
      'implementQuery expected a query specification',
    )
  })
})
