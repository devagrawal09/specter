import { createQuerySlice, event } from '@specter-ts/spec'

const observation = {
  kind: 'command.completed',
  observationId: 'observation-1',
  sequence: 1,
  observedAt: '2026-07-18T12:00:00.000Z',
  source: {
    application: 'todo-reference',
    environment: 'development',
    runtimeLanguage: 'typescript',
    runtimeVersion: '0.4.0',
    instanceId: 'instance-1',
    eventLogId: 'todo-log',
  },
  operationId: 'operation-1',
}

export const runtimeOverviewSpec = createQuerySlice('runtimeOverview')
  .description('Summarizes all runtime sources observed by the collector.')
  .scenarios({
    description: 'Summarizes one successful runtime operation.',
    given: [event('runtime-observation-recorded', { observation })],
    when: {},
    expect: {
      generatedAt: '2026-07-18T12:00:01.000Z',
      collectorVersion: 1,
      observationCount: 1,
      failureCount: 0,
      rejectionCount: 0,
      droppedObservationCount: 0,
      sources: [
        {
          source: observation.source,
          observationCount: 1,
          failureCount: 0,
          rejectionCount: 0,
          droppedObservationCount: 0,
          lastSequence: 1,
          lastObservedAt: observation.observedAt,
          projectionLag: 0,
        },
      ],
      kinds: { 'command.completed': 1 },
      recent: [{ ...observation, collectorOrder: 1 }],
    },
  })

export default runtimeOverviewSpec
