import type { StandardSchemaV1 } from '@standard-schema/spec'
import { describe, expect, it } from 'vitest'

import { createEventDefinition } from '../definition'
import { createCommandSlice, createQuerySlice, event } from '../spec-entry'
import {
  analyzeEventPropagation,
  formatEventPropagation,
} from './event-propagation'
import { createTestSliceStore } from './test-slice-store'

const schema = {
  '~standard': {
    version: 1,
    vendor: 'specter-core-test',
    validate: (value: unknown) => ({ value }),
  },
} as StandardSchemaV1

const store = createTestSliceStore<Record<string, unknown>>({})

describe('Event propagation analysis', () => {
  it('names every producer scenario, Given example, and apply handler affected by an Event payload change', () => {
    const todoAdded = createEventDefinition('todo-added', schema)
    const addTodo = createCommandSlice('addTodo')
      .description('Adds a todo.')
      .scenarios({
        description: 'Adds one todo.',
        given: [],
        when: { todoId: 'todo-1' },
        expect: [event('todo-added', { todoId: 'todo-1' })],
      })
      .inputSchema<{ todoId: string }>()
      .store(store.tag)
      .handle(async (input) => [todoAdded.create(input)])
    const todosQuery = createQuerySlice('todosQuery')
      .description('Lists todos.')
      .scenarios({
        description: 'Lists an added todo.',
        given: [event('todo-added', { todoId: 'todo-1' })],
        when: {},
        expect: [{ todoId: 'todo-1' }],
      })
      .inputSchema<Record<string, never>>()
      .outputSchema<readonly { todoId: string }[]>()
      .store(store.tag)
      .apply(todoAdded, async () => undefined)
      .handle(async () => [{ todoId: 'todo-1' }])

    const [impact] = analyzeEventPropagation({
      events: [todoAdded],
      slices: [addTodo, todosQuery],
    })

    expect(impact).toMatchObject({
      eventType: 'todo-added',
      producedBy: [
        {
          sliceName: 'addTodo',
          location: 'expect',
          sliceKind: 'command',
          scenarioIndex: 0,
          eventIndex: 0,
        },
      ],
      consumedBy: [
        { sliceName: 'todosQuery', sliceKind: 'query', applyIndex: 0 },
      ],
      scenarioExamples: [
        {
          sliceName: 'addTodo',
          location: 'expect',
          scenarioIndex: 0,
          eventIndex: 0,
        },
        {
          sliceName: 'todosQuery',
          location: 'given',
          scenarioIndex: 0,
          eventIndex: 0,
        },
      ],
    })
    expect(formatEventPropagation(impact as NonNullable<typeof impact>)).toBe(
      [
        'Event "todo-added" propagation:',
        '  Command outcomes:',
        '    - addTodo: scenario[0] "Adds one todo." expect[0]',
        '  Apply handlers:',
        '    - query todosQuery: apply[0]',
        '  Scenario examples to update:',
        '    - addTodo: scenario[0] "Adds one todo." expect[0]',
        '    - todosQuery: scenario[0] "Lists an added todo." given[0]',
      ].join('\n'),
    )
  })

  it('reports every repeated occurrence with its scenario and Event position', () => {
    const todoAdded = createEventDefinition('todo-added', schema)
    const addTodo = createCommandSlice('addTodo')
      .description('Adds todos.')
      .scenarios(
        {
          description: 'Adds the same todo twice.',
          given: [],
          when: {},
          expect: [
            event('todo-added', { todoId: 'todo-1' }),
            event('todo-added', { todoId: 'todo-1' }),
          ],
        },
        {
          description: 'Adds another todo.',
          given: [event('todo-added', { todoId: 'todo-1' })],
          when: {},
          expect: [event('todo-added', { todoId: 'todo-2' })],
        },
      )
      .inputSchema<Record<string, never>>()
      .store(store.tag)
      .apply(todoAdded, async () => undefined)
      .handle(async () => [todoAdded.create({ todoId: 'todo-2' })])

    const [impact] = analyzeEventPropagation({
      events: [todoAdded],
      slices: [addTodo],
    })

    expect(impact?.producedBy).toMatchObject([
      { scenarioIndex: 0, location: 'expect', eventIndex: 0 },
      { scenarioIndex: 0, location: 'expect', eventIndex: 1 },
      { scenarioIndex: 1, location: 'expect', eventIndex: 0 },
    ])
    expect(impact?.scenarioExamples).toMatchObject([
      { scenarioIndex: 0, location: 'expect', eventIndex: 0 },
      { scenarioIndex: 0, location: 'expect', eventIndex: 1 },
      { scenarioIndex: 1, location: 'given', eventIndex: 0 },
      { scenarioIndex: 1, location: 'expect', eventIndex: 0 },
    ])
    expect(
      formatEventPropagation(impact as NonNullable<typeof impact>),
    ).toContain('scenario[0] "Adds the same todo twice." expect[1]')
  })

  it('rejects duplicate and unknown Event catalogs with remediation context', () => {
    const todoAdded = createEventDefinition('todo-added', schema)
    expect(() =>
      analyzeEventPropagation({ events: [todoAdded, todoAdded], slices: [] }),
    ).toThrow('registered more than once')
    expect(() =>
      analyzeEventPropagation(
        { events: [todoAdded], slices: [] },
        'todo-removed',
      ),
    ).toThrow('Register its EventDefinition first')
  })
})
