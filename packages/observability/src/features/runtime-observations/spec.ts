import { createCommandSlice, event } from '@specter-ts/spec'

const exampleObservation = {
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

export const recordRuntimeObservationsSpec = createCommandSlice(
  'recordRuntimeObservations',
)
  .description('Records a validated batch of runtime observations.')
  .scenarios({
    description: 'Records each observation as an operational Event.',
    given: [
      event('runtime-observation-recorded', {
        observation: {
          ...exampleObservation,
          observationId: 'observation-0',
          sequence: 0,
          operationId: 'operation-0',
        },
      }),
    ],
    when: {
      requestId: 'batch-1',
      observations: [exampleObservation],
    },
    expect: [
      event('runtime-observation-recorded', {
        observation: exampleObservation,
      }),
    ],
  })

export default recordRuntimeObservationsSpec
