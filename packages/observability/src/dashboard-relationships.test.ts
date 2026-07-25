import type { SliceSpecification } from '@specter-ts/spec'
import { describe, expect, it } from 'vitest'

import {
  buildContractGraph,
  focusedContractGraph,
  sliceNodeId,
} from './dashboard-relationships'
import { runtimeSourceIdentity } from './dashboard-model'
import type { CollectedSpecification } from './specification-catalog'

const source = {
  application: 'todo',
  environment: 'development',
  runtimeLanguage: 'typescript',
  runtimeVersion: '0.4.0',
  instanceId: 'one',
  eventLogId: 'todo-log',
}

function collected(
  digest: `sha256:${string}`,
  document: SliceSpecification,
  sources = [source],
): CollectedSpecification {
  return {
    digest,
    document,
    firstPublishedAt: '2026-07-22T12:00:00.000Z',
    sources,
  }
}

const base = {
  $schema: 'https://specter.dev/specification/v1/slice.schema.json' as const,
  formatVersion: 1 as const,
  description: 'Example.',
}

describe('contract relationship graph', () => {
  const addTodo = collected('sha256:add', {
    ...base,
    kind: 'command',
    name: 'addTodo',
    scenarios: [
      {
        description: 'Adds a todo.',
        given: [],
        when: { title: 'Ship it' },
        expect: [
          {
            kind: 'scenario-event',
            eventType: 'todo-added',
            examplePayload: { title: 'Ship it' },
          },
        ],
      },
    ],
  })
  const listTodos = collected('sha256:list', {
    ...base,
    kind: 'query',
    name: 'todosQuery',
    scenarios: [
      {
        description: 'Lists todos.',
        given: [
          {
            kind: 'scenario-event',
            eventType: 'todo-added',
            examplePayload: { title: 'Ship it' },
          },
        ],
        when: {},
        expect: [{ title: 'Ship it' }],
      },
    ],
  })
  const celebrate = collected('sha256:reaction', {
    ...base,
    kind: 'reaction',
    name: 'celebrateTodo',
    scenarios: [
      {
        description: 'Requests another command.',
        given: [
          {
            kind: 'scenario-event',
            eventType: 'todo-added',
            examplePayload: { title: 'Ship it' },
          },
        ],
        expect: [{ type: 'addTodo', payload: { title: 'Celebrate' } }],
      },
    ],
  })

  it('uses precise relationships from portable scenarios', () => {
    const graph = buildContractGraph([addTodo, listTodos, celebrate], {
      application: 'todo',
      environment: 'development',
    })

    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: sliceNodeId('sha256:add'),
          to: 'event:todo-added',
          kind: 'expects-event',
        }),
        expect.objectContaining({
          from: 'event:todo-added',
          to: sliceNodeId('sha256:list'),
          kind: 'uses-given',
        }),
        expect.objectContaining({
          from: sliceNodeId('sha256:reaction'),
          to: sliceNodeId('sha256:add'),
          kind: 'requests-command',
        }),
      ]),
    )
  })

  it('keeps the selected Slice and its connected paths focused', () => {
    const focused = focusedContractGraph(
      buildContractGraph([addTodo, listTodos, celebrate], {
        application: 'todo',
        environment: 'development',
      }),
      'sha256:add',
    )

    expect(focused.nodes.map((node) => node.label)).toEqual(
      expect.arrayContaining([
        'addTodo',
        'todosQuery',
        'celebrateTodo',
        'todo-added',
      ]),
    )
  })

  it('uses the selected complete source instead of merging the environment', () => {
    const otherSource = { ...source, instanceId: 'two' }
    const otherList = collected(
      'sha256:other-list',
      {
        ...listTodos.document,
        name: 'otherTodosQuery',
      },
      [otherSource],
    )
    const graph = buildContractGraph([addTodo, listTodos, otherList], {
      application: 'todo',
      environment: 'development',
      source: runtimeSourceIdentity(source),
    })

    expect(graph.nodes.some((node) => node.digest === otherList.digest)).toBe(
      false,
    )
    expect(graph.nodes.some((node) => node.digest === listTodos.digest)).toBe(
      true,
    )
  })

  it('marks same-source command revisions as ambiguous', () => {
    const oldAddTodo = collected('sha256:old-add', {
      ...addTodo.document,
      description: 'Older add behavior.',
    })
    const graph = buildContractGraph([addTodo, oldAddTodo, celebrate], {
      application: 'todo',
      environment: 'development',
      source: runtimeSourceIdentity(source),
    })

    expect(graph.nodes).toContainEqual(
      expect.objectContaining({
        id: 'ambiguous-command:addTodo',
        kind: 'ambiguous-command',
      }),
    )
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        from: sliceNodeId(celebrate.digest),
        to: 'ambiguous-command:addTodo',
        kind: 'requests-command',
      }),
    )
  })
})
