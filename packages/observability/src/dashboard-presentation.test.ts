import { describe, expect, it } from 'vitest'

import { humanizeLabel, presentValue } from './dashboard-presentation'

describe('dashboard semantic presentation', () => {
  it('humanizes Slice, Event, and field identifiers', () => {
    expect(humanizeLabel('todo-completion-changed')).toBe(
      'Todo completion changed',
    )
    expect(humanizeLabel('createTodoCheer')).toBe('Create todo cheer')
    expect(humanizeLabel('todoId')).toBe('Todo ID')
  })

  it('preserves nested portable values as labeled presentation data', () => {
    expect(
      presentValue({
        todoId: 'todo-1',
        completed: true,
        metadata: { attemptCount: 2 },
        tags: ['launch', 'reference'],
      }),
    ).toEqual({
      kind: 'record',
      fields: [
        {
          label: 'Todo ID',
          value: { kind: 'scalar', text: 'todo-1', tone: 'text' },
        },
        {
          label: 'Completed',
          value: { kind: 'scalar', text: 'Yes', tone: 'boolean' },
        },
        {
          label: 'Metadata',
          value: {
            kind: 'record',
            fields: [
              {
                label: 'Attempt count',
                value: { kind: 'scalar', text: '2', tone: 'number' },
              },
            ],
          },
        },
        {
          label: 'Tags',
          value: {
            kind: 'list',
            items: [
              { kind: 'scalar', text: 'launch', tone: 'text' },
              { kind: 'scalar', text: 'reference', tone: 'text' },
            ],
          },
        },
      ],
    })
  })

  it('uses plain-language empty and boolean values', () => {
    expect(presentValue(null)).toEqual({
      kind: 'scalar',
      text: 'None',
      tone: 'empty',
    })
    expect(presentValue([])).toEqual({ kind: 'list', items: [] })
    expect(presentValue(false)).toEqual({
      kind: 'scalar',
      text: 'No',
      tone: 'boolean',
    })
  })
})
