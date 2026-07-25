import { createQuerySlice, event } from '@specter-ts/spec'

export const reactiveNodeValueSpec = createQuerySlice('reactiveNodeValue')
  .description('Reads the current value of a signal or settled computation.')
  .scenarios(
    {
      description: 'Reads the initial value of a signal.',
      given: [
        event('reactive-signal-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'signal-1',
          value: 1,
        }),
      ],
      when: {
        graphId: 'graph-1',
        nodeId: 'signal-1',
      },
      expect: 1,
    },
    {
      description: 'Reads the latest written value of a signal.',
      given: [
        event('reactive-signal-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'signal-1',
          value: 1,
        }),
        event('reactive-signal-written', {
          graphId: 'graph-1',
          batchId: 'update-1',
          nodeId: 'signal-1',
          previousValue: 1,
          value: 2,
          changed: true,
        }),
      ],
      when: {
        graphId: 'graph-1',
        nodeId: 'signal-1',
      },
      expect: 2,
    },
    {
      description: 'Reads the latest settled value of a computation.',
      given: [
        event('reactive-computation-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'computed-1',
          callbackId: 'double',
        }),
        event('reactive-computation-evaluated', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'computed-1',
          value: {
            total: 4,
          },
          dependencyNodeIds: ['signal-1'],
          changed: true,
        }),
      ],
      when: {
        graphId: 'graph-1',
        nodeId: 'computed-1',
      },
      expect: {
        total: 4,
      },
    },
  )

export default reactiveNodeValueSpec
