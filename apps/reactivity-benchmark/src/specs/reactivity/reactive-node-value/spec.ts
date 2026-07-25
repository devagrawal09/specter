import { createQuerySlice, event } from '@specter-ts/spec'

export const reactiveNodeValueSpec = createQuerySlice('reactiveNodeValue')
  .description(
    'Reports an explicit availability status for a node in an in-memory benchmark graph.',
  )
  .scenarios(
    {
      description: 'Reports an open batch instead of exposing partial state.',
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
      expect: {
        status: 'batch-open',
        batchId: 'build-1',
      },
    },
    {
      description: 'Reads the settled initial value of a signal.',
      given: [
        event('reactive-signal-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'signal-1',
          value: 1,
        }),
        event('reactive-batch-settled', {
          graphId: 'graph-1',
          batchId: 'build-1',
          evaluatedComputationCount: 0,
          executedEffectCount: 0,
        }),
      ],
      when: {
        graphId: 'graph-1',
        nodeId: 'signal-1',
      },
      expect: {
        status: 'available',
        value: 1,
      },
    },
    {
      description: 'Reads the latest settled value of a signal.',
      given: [
        event('reactive-signal-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'signal-1',
          value: 1,
        }),
        event('reactive-batch-settled', {
          graphId: 'graph-1',
          batchId: 'build-1',
          evaluatedComputationCount: 0,
          executedEffectCount: 0,
        }),
        event('reactive-signal-written', {
          graphId: 'graph-1',
          batchId: 'update-1',
          nodeId: 'signal-1',
          previousValue: 1,
          value: 2,
          changed: true,
        }),
        event('reactive-batch-settled', {
          graphId: 'graph-1',
          batchId: 'update-1',
          evaluatedComputationCount: 0,
          executedEffectCount: 0,
        }),
      ],
      when: {
        graphId: 'graph-1',
        nodeId: 'signal-1',
      },
      expect: {
        status: 'available',
        value: 2,
      },
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
        event('reactive-batch-settled', {
          graphId: 'graph-1',
          batchId: 'build-1',
          evaluatedComputationCount: 1,
          executedEffectCount: 0,
        }),
      ],
      when: {
        graphId: 'graph-1',
        nodeId: 'computed-1',
      },
      expect: {
        status: 'available',
        value: {
          total: 4,
        },
      },
    },
    {
      description: 'Reports an effect as not readable after settlement.',
      given: [
        event('reactive-effect-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'effect-1',
          callbackId: 'observe-value',
        }),
        event('reactive-effect-executed', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'effect-1',
          dependencyNodeIds: [],
        }),
        event('reactive-batch-settled', {
          graphId: 'graph-1',
          batchId: 'build-1',
          evaluatedComputationCount: 0,
          executedEffectCount: 1,
        }),
      ],
      when: {
        graphId: 'graph-1',
        nodeId: 'effect-1',
      },
      expect: {
        status: 'not-readable',
      },
    },
    {
      description: 'Reports an unknown node in a settled graph.',
      given: [
        event('reactive-signal-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'signal-1',
          value: 1,
        }),
        event('reactive-batch-settled', {
          graphId: 'graph-1',
          batchId: 'build-1',
          evaluatedComputationCount: 0,
          executedEffectCount: 0,
        }),
      ],
      when: {
        graphId: 'graph-1',
        nodeId: 'missing',
      },
      expect: {
        status: 'not-found',
      },
    },
    {
      description: 'Reports an unknown graph.',
      given: [],
      when: {
        graphId: 'missing',
        nodeId: 'signal-1',
      },
      expect: {
        status: 'graph-not-found',
      },
    },
    {
      description: 'Reports a disposed graph instead of retaining node values.',
      given: [
        event('reactive-signal-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'signal-1',
          value: 1,
        }),
        event('reactive-batch-settled', {
          graphId: 'graph-1',
          batchId: 'build-1',
          evaluatedComputationCount: 0,
          executedEffectCount: 0,
        }),
        event('reactive-graph-disposed', {
          graphId: 'graph-1',
        }),
      ],
      when: {
        graphId: 'graph-1',
        nodeId: 'signal-1',
      },
      expect: {
        status: 'graph-disposed',
      },
    },
    {
      description: 'Keeps another graph available when identifiers are reused.',
      given: [
        event('reactive-signal-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'signal-1',
          value: 1,
        }),
        event('reactive-batch-settled', {
          graphId: 'graph-1',
          batchId: 'build-1',
          evaluatedComputationCount: 0,
          executedEffectCount: 0,
        }),
        event('reactive-signal-created', {
          graphId: 'graph-2',
          batchId: 'build-1',
          nodeId: 'signal-1',
          value: 2,
        }),
        event('reactive-batch-settled', {
          graphId: 'graph-2',
          batchId: 'build-1',
          evaluatedComputationCount: 0,
          executedEffectCount: 0,
        }),
        event('reactive-graph-disposed', {
          graphId: 'graph-1',
        }),
      ],
      when: {
        graphId: 'graph-2',
        nodeId: 'signal-1',
      },
      expect: {
        status: 'available',
        value: 2,
      },
    },
  )

export default reactiveNodeValueSpec
