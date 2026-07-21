import { createQuerySlice, event } from '@specter-ts/core/spec'

const observation = {
  kind: 'query.failed',
  observationId: 'observation-2',
  sequence: 2,
  observedAt: '2026-07-18T12:00:00.000Z',
  source: {
    application: 'todo-reference',
    environment: 'development',
    runtimeLanguage: 'typescript',
    runtimeVersion: '0.4.0',
    instanceId: 'instance-1',
    eventLogId: 'todo-log',
  },
  operationId: 'operation-2',
  outcome: 'failed',
}

export const runtimeActivitySpec = createQuerySlice('runtimeActivity')
  .description('Returns filtered chronological runtime observations.')
  .scenarios({
    description: 'Filters runtime observations by application and kind.',
    given: [event('runtime-observation-recorded', { observation })],
    when: {
      application: 'todo-reference',
      kind: 'query.failed',
      limit: 100,
    },
    expect: [{ ...observation, collectorOrder: 1 }],
  })
