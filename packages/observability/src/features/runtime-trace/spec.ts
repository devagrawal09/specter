import { createQuerySlice, event } from '@specter-ts/core/spec'

const observation = {
  kind: 'reaction.run.completed',
  observationId: 'observation-3',
  sequence: 3,
  observedAt: '2026-07-18T12:00:00.000Z',
  source: {
    application: 'todo-reference',
    environment: 'development',
    runtimeLanguage: 'typescript',
    runtimeVersion: '0.4.0',
    instanceId: 'instance-1',
    eventLogId: 'todo-log',
  },
  operationId: 'operation-3',
}

export const runtimeTraceSpec = createQuerySlice('runtimeTrace')
  .description('Builds a causal trace around one runtime operation.')
  .scenarios({
    description: 'Returns the selected operation.',
    given: [event('runtime-observation-recorded', { observation })],
    when: { operationId: 'operation-3' },
    expect: {
      operationId: 'operation-3',
      observations: [{ ...observation, collectorOrder: 1 }],
      edges: [],
    },
  })
