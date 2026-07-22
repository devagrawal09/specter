import {
  createCommandSlice,
  digestSpecification,
  event,
} from '@specter-ts/spec'
import { describe, expect, it } from 'vitest'
import { parseProtocolMessage } from './validation'

const document = createCommandSlice('addTodo')
  .description('Adds a todo.')
  .scenarios({
    description: 'Adds one.',
    given: [],
    when: { id: '1' },
    expect: [event('todo-added', { id: '1' })],
  })

describe('specification publication protocol', () => {
  it('accepts a canonical document and digest', () => {
    const message = {
      protocolVersion: 1,
      kind: 'specifications.publish',
      requestId: 'request-1',
      source: {
        application: 'todo',
        environment: 'test',
        runtimeLanguage: 'typescript',
        runtimeVersion: '0.3.0',
        instanceId: 'one',
        eventLogId: 'log',
      },
      specifications: [{ digest: digestSpecification(document), document }],
    }
    expect(parseProtocolMessage(message)).toEqual(message)
  })

  it('rejects a digest that does not identify the document', () => {
    expect(() =>
      parseProtocolMessage({
        protocolVersion: 1,
        kind: 'specifications.publish',
        requestId: 'request-1',
        source: {
          application: 'todo',
          environment: 'test',
          runtimeLanguage: 'typescript',
          runtimeVersion: '0.3.0',
          instanceId: 'one',
          eventLogId: 'log',
        },
        specifications: [{ digest: `sha256:${'0'.repeat(64)}`, document }],
      }),
    ).toThrow('does not match')
  })
})
