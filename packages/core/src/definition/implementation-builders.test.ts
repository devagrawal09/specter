import { createCommandSlice, event } from '@specter-ts/spec'
import { Context } from 'effect'
import { describe, expect, it } from 'vitest'
import type { SliceStoreService } from '../adapters'
import { createEventDefinition } from './events'
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
  it('loads raw JSON text and preserves its runtime Slice name', () => {
    const implementation = implementCommand(commandJson)
    const name: string = implementation.name
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

  it('retains the Store tag through apply registration', () => {
    const store =
      Context.Service<SliceStoreService<unknown, unknown>>('specter-test/Store')
    const added = createEventDefinition('todo-added', {
      '~standard': {
        version: 1,
        vendor: 'specter-test',
        validate: (value) => ({ value }),
      },
    })
    const implementation = implementCommand(commandJson)
      .inputSchema<{ id: string }>()
      .store(store)
      .apply(added, async () => undefined)
      .handle(async (input) => [added.create(input)])

    expect(implementation.store).toBe(store)
    expect(implementation.apply).toHaveLength(1)
  })
})
