import { createCommandSlice, event } from '@specter-ts/spec'

export const createReactiveSignalSpec = createCommandSlice(
  'createReactiveSignal',
)
  .description(
    'Creates a writable portable-JSON signal in the one open batch of an in-memory benchmark graph.',
  )
  .scenarios(
    {
      description: 'Creates a signal with its initial value.',
      given: [],
      when: {
        graphId: 'graph-1',
        batchId: 'build-1',
        nodeId: 'signal-1',
        initialValue: 1,
      },
      expect: [
        event('reactive-signal-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'signal-1',
          value: 1,
        }),
      ],
    },
    {
      description: 'Adds another signal to the open build batch.',
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
        batchId: 'build-1',
        nodeId: 'signal-2',
        initialValue: 2,
      },
      expect: [
        event('reactive-signal-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'signal-2',
          value: 2,
        }),
      ],
    },
    {
      description:
        'Scopes a reused node and batch identifier to another graph.',
      given: [
        event('reactive-signal-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'signal-1',
          value: 1,
        }),
      ],
      when: {
        graphId: 'graph-2',
        batchId: 'build-1',
        nodeId: 'signal-1',
        initialValue: 2,
      },
      expect: [
        event('reactive-signal-created', {
          graphId: 'graph-2',
          batchId: 'build-1',
          nodeId: 'signal-1',
          value: 2,
        }),
      ],
    },
    {
      description: 'Rejects a different batch while the build batch is open.',
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
        batchId: 'build-2',
        nodeId: 'signal-2',
        initialValue: 2,
      },
      expect: [],
      reject: {
        reason: 'Reactive batch build-1 is already open in graph graph-1',
      },
    },
    {
      description: 'Rejects creation in a batch that has already settled.',
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
        nodeId: 'signal-2',
        initialValue: 2,
      },
      expect: [],
      reject: {
        reason: 'Reactive batch build-1 is already settled in graph graph-1',
      },
    },
    {
      description: 'Rejects an identifier already used by a signal.',
      given: [
        event('reactive-signal-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'node-1',
          value: 1,
        }),
      ],
      when: {
        graphId: 'graph-1',
        batchId: 'build-1',
        nodeId: 'node-1',
        initialValue: 2,
      },
      expect: [],
      reject: {
        reason: 'Reactive node node-1 already exists in graph graph-1',
      },
    },
    {
      description: 'Rejects an identifier already used by a computation.',
      given: [
        event('reactive-computation-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'node-1',
          callbackId: 'double',
        }),
      ],
      when: {
        graphId: 'graph-1',
        batchId: 'build-1',
        nodeId: 'node-1',
        initialValue: 2,
      },
      expect: [],
      reject: {
        reason: 'Reactive node node-1 already exists in graph graph-1',
      },
    },
    {
      description: 'Rejects an identifier already used by an effect.',
      given: [
        event('reactive-effect-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'node-1',
          callbackId: 'observe-value',
        }),
      ],
      when: {
        graphId: 'graph-1',
        batchId: 'build-1',
        nodeId: 'node-1',
        initialValue: 2,
      },
      expect: [],
      reject: {
        reason: 'Reactive node node-1 already exists in graph graph-1',
      },
    },
    {
      description: 'Rejects creation in a disposed graph.',
      given: [
        event('reactive-graph-disposed', {
          graphId: 'graph-1',
        }),
      ],
      when: {
        graphId: 'graph-1',
        batchId: 'build-2',
        nodeId: 'signal-1',
        initialValue: 1,
      },
      expect: [],
      reject: {
        reason: 'Reactive graph graph-1 is disposed',
      },
    },
  )

export default createReactiveSignalSpec
