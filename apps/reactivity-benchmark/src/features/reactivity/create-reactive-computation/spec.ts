import { createCommandSlice, event } from '@specter-ts/spec'

export const createReactiveComputationSpec = createCommandSlice(
  'createReactiveComputation',
)
  .description(
    'Creates a derived node in the open batch using a graph-owned synchronous benchmark callback.',
  )
  .scenarios(
    {
      description:
        'Creates a computation without evaluating it before settlement.',
      given: [],
      when: {
        graphId: 'graph-1',
        batchId: 'build-1',
        nodeId: 'computed-1',
        callbackId: 'double-signal-1',
      },
      expect: [
        event('reactive-computation-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'computed-1',
          callbackId: 'double-signal-1',
        }),
      ],
    },
    {
      description: 'Creates a computation in the existing open build batch.',
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
        nodeId: 'computed-1',
        callbackId: 'double-signal-1',
      },
      expect: [
        event('reactive-computation-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'computed-1',
          callbackId: 'double-signal-1',
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
        nodeId: 'computed-1',
        callbackId: 'double-signal-1',
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
        nodeId: 'computed-1',
        callbackId: 'double-signal-1',
      },
      expect: [],
      reject: {
        reason: 'Reactive batch build-1 is already settled in graph graph-1',
      },
    },
    {
      description: 'Rejects an unregistered callback identifier.',
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
        nodeId: 'computed-1',
        callbackId: 'missing-callback',
      },
      expect: [],
      reject: {
        reason:
          'Reactive callback missing-callback is not registered in graph graph-1',
      },
    },
    {
      description: 'Rejects a callback already assigned to another node.',
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
        nodeId: 'computed-2',
        callbackId: 'double',
      },
      expect: [],
      reject: {
        reason: 'Reactive callback double is already assigned in graph graph-1',
      },
    },
    {
      description: 'Rejects a callback already assigned to an effect.',
      given: [
        event('reactive-effect-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'effect-1',
          callbackId: 'shared-callback',
        }),
      ],
      when: {
        graphId: 'graph-1',
        batchId: 'build-1',
        nodeId: 'computed-1',
        callbackId: 'shared-callback',
      },
      expect: [],
      reject: {
        reason:
          'Reactive callback shared-callback is already assigned in graph graph-1',
      },
    },
    {
      description: 'Scopes a reused callback identifier to another graph.',
      given: [
        event('reactive-computation-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'computed-1',
          callbackId: 'double',
        }),
      ],
      when: {
        graphId: 'graph-2',
        batchId: 'build-1',
        nodeId: 'computed-1',
        callbackId: 'double',
      },
      expect: [
        event('reactive-computation-created', {
          graphId: 'graph-2',
          batchId: 'build-1',
          nodeId: 'computed-1',
          callbackId: 'double',
        }),
      ],
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
        callbackId: 'double',
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
        callbackId: 'triple',
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
        callbackId: 'double',
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
        nodeId: 'computed-1',
        callbackId: 'double',
      },
      expect: [],
      reject: {
        reason: 'Reactive graph graph-1 is disposed',
      },
    },
  )

export default createReactiveComputationSpec
