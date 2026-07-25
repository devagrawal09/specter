import { createCommandSlice, event } from '@specter-ts/spec'

export const writeReactiveSignalSpec = createCommandSlice('writeReactiveSignal')
  .description(
    'Records every portable-JSON signal write and compares live values with Object.is inside the open graph batch.',
  )
  .scenarios(
    {
      description: 'Records a changed signal value.',
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
        batchId: 'update-1',
        nodeId: 'signal-1',
        value: 2,
      },
      expect: [
        event('reactive-signal-written', {
          graphId: 'graph-1',
          batchId: 'update-1',
          nodeId: 'signal-1',
          previousValue: 1,
          value: 2,
          changed: true,
        }),
      ],
    },
    {
      description: 'Records an equal-value write without marking it changed.',
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
        batchId: 'update-1',
        nodeId: 'signal-1',
        value: 1,
      },
      expect: [
        event('reactive-signal-written', {
          graphId: 'graph-1',
          batchId: 'update-1',
          nodeId: 'signal-1',
          previousValue: 1,
          value: 1,
          changed: false,
        }),
      ],
    },
    {
      description: 'Treats an equal-shaped record write as a changed identity.',
      given: [
        event('reactive-signal-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'signal-1',
          value: {
            total: 1,
          },
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
        batchId: 'update-1',
        nodeId: 'signal-1',
        value: {
          total: 1,
        },
      },
      expect: [
        event('reactive-signal-written', {
          graphId: 'graph-1',
          batchId: 'update-1',
          nodeId: 'signal-1',
          previousValue: {
            total: 1,
          },
          value: {
            total: 1,
          },
          changed: true,
        }),
      ],
    },
    {
      description: 'Records each write in a multi-write batch.',
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
      ],
      when: {
        graphId: 'graph-1',
        batchId: 'update-1',
        nodeId: 'signal-1',
        value: 3,
      },
      expect: [
        event('reactive-signal-written', {
          graphId: 'graph-1',
          batchId: 'update-1',
          nodeId: 'signal-1',
          previousValue: 2,
          value: 3,
          changed: true,
        }),
      ],
    },
    {
      description: 'Rejects a different batch while an update batch is open.',
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
      ],
      when: {
        graphId: 'graph-1',
        batchId: 'update-2',
        nodeId: 'signal-1',
        value: 3,
      },
      expect: [],
      reject: {
        reason: 'Reactive batch update-1 is already open in graph graph-1',
      },
    },
    {
      description: 'Rejects a write in a batch that has already settled.',
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
        batchId: 'build-1',
        nodeId: 'signal-1',
        value: 2,
      },
      expect: [],
      reject: {
        reason: 'Reactive batch build-1 is already settled in graph graph-1',
      },
    },
    {
      description: 'Rejects a write to an unknown node.',
      given: [],
      when: {
        graphId: 'graph-1',
        batchId: 'update-1',
        nodeId: 'missing',
        value: 2,
      },
      expect: [],
      reject: {
        reason: 'Reactive signal missing was not found in graph graph-1',
      },
    },
    {
      description: 'Rejects a write to a computation.',
      given: [
        event('reactive-computation-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'computed-1',
          callbackId: 'double',
        }),
      ],
      when: {
        graphId: 'graph-1',
        batchId: 'build-1',
        nodeId: 'computed-1',
        value: 2,
      },
      expect: [],
      reject: {
        reason: 'Reactive node computed-1 is not a signal',
      },
    },
    {
      description: 'Rejects a write to an effect.',
      given: [
        event('reactive-effect-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'effect-1',
          callbackId: 'observe-value',
        }),
      ],
      when: {
        graphId: 'graph-1',
        batchId: 'build-1',
        nodeId: 'effect-1',
        value: 2,
      },
      expect: [],
      reject: {
        reason: 'Reactive node effect-1 is not a signal',
      },
    },
    {
      description: 'Rejects a write in a disposed graph.',
      given: [
        event('reactive-signal-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'signal-1',
          value: 1,
        }),
        event('reactive-graph-disposed', {
          graphId: 'graph-1',
        }),
      ],
      when: {
        graphId: 'graph-1',
        batchId: 'update-1',
        nodeId: 'signal-1',
        value: 2,
      },
      expect: [],
      reject: {
        reason: 'Reactive graph graph-1 is disposed',
      },
    },
  )

export default writeReactiveSignalSpec
