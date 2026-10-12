import type { StandardSchemaV1 } from '@standard-schema/spec'
import { describe, expect, it } from 'vitest'

import {
  createEventDefinition,
  extendSpecterConfig,
  prepareSpecterApp,
} from '..'
import { createCommandSlice, event } from '../definition'
import { createTestSliceStore } from '../testing/test-slice-store'

function schema<T>(): StandardSchemaV1<T, T> {
  return {
    '~standard': {
      version: 1,
      vendor: 'specter-extend-test',
      validate: (value) => ({ value: value as T }),
    },
  }
}

const todoAdded = createEventDefinition(
  'todo-added',
  schema<{ readonly todoId: string }>(),
)
const todoImported = createEventDefinition(
  'todo-imported',
  schema<{ readonly todoId: string }>(),
)

function command(name: string, eventType: 'todo-added' | 'todo-imported') {
  const store = createTestSliceStore({})
  const definition = eventType === 'todo-added' ? todoAdded : todoImported
  return createCommandSlice(name)
    .description(`Records a ${eventType}.`)
    .scenarios({
      description: `Records one ${eventType}.`,
      given: [],
      when: { todoId: 't1' },
      expect: [event(eventType, { todoId: 't1' })],
    })
    .inputSchema<{ readonly todoId: string }>()
    .store(store.tag)
    .handle(async (input) => [definition.create(input)])
}

const addTodo = command('addTodo', 'todo-added')
const production = { events: [todoAdded], slices: { addTodo } } as const

describe('extendSpecterConfig', () => {
  it('registers test-only Slices and their Events beside a config', async () => {
    const importTodos = command('importTodos', 'todo-imported')
    const extended = extendSpecterConfig(production, {
      slices: { importTodos },
      events: [todoAdded, todoImported],
    })

    expect(Object.keys(extended.slices)).toEqual(['addTodo', 'importTodos'])
    expect(extended.events).toEqual([todoAdded, todoImported])
    expect(production.slices).toEqual({ addTodo })
    await expect(prepareSpecterApp(extended)).resolves.toMatchObject({
      config: extended,
    })
  })

  it('returns the config as it is when nothing extends it', () => {
    const extended = extendSpecterConfig(production, {})

    expect(extended).toEqual(production)
  })

  it('never replaces a Slice the config registers', () => {
    expect(() =>
      extendSpecterConfig(production, {
        slices: { addTodo: command('addTodo', 'todo-imported') },
      }),
    ).toThrow('Slice "addTodo" is registered already')
  })
})
