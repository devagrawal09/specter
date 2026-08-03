import { createCommandSlice, event } from '@specter-ts/spec'

export const createReactiveEffectSpec = createCommandSlice(
  'createReactiveEffect',
)
  .description(
    'Creates an effect in the open batch using a graph-owned synchronous benchmark callback.',
  )
  .scenarios(
    {
      description: 'Creates an effect without executing it before settlement.',
      given: [],
      when: {
        graphId: 'graph-1',
        batchId: 'build-1',
        nodeId: 'effect-1',
        callbackId: 'observe-computed-1',
      },
      expect: [
        event('reactive-effect-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'effect-1',
          callbackId: 'observe-computed-1',
        }),
      ],
    },
    {
      description: 'Creates an effect in the existing open build batch.',
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
        nodeId: 'effect-1',
        callbackId: 'observe-signal-1',
      },
      expect: [
        event('reactive-effect-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'effect-1',
          callbackId: 'observe-signal-1',
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
        nodeId: 'effect-1',
        callbackId: 'observe-signal-1',
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
        nodeId: 'effect-1',
        callbackId: 'observe-signal-1',
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
        nodeId: 'effect-1',
        callbackId: 'missing-callback',
      },
      expect: [],
      reject: {
        reason:
          'Reactive callback missing-callback is not registered in graph graph-1',
      },
    },
    {
      description: 'Rejects a callback already assigned to a computation.',
      given: [
        event('reactive-computation-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'computed-1',
          callbackId: 'shared-callback',
        }),
      ],
      when: {
        graphId: 'graph-1',
        batchId: 'build-1',
        nodeId: 'effect-1',
        callbackId: 'shared-callback',
      },
      expect: [],
      reject: {
        reason:
          'Reactive callback shared-callback is already assigned in graph graph-1',
      },
    },
    {
      description: 'Rejects a callback already assigned to another effect.',
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
        nodeId: 'effect-2',
        callbackId: 'shared-callback',
      },
      expect: [],
      reject: {
        reason:
          'Reactive callback shared-callback is already assigned in graph graph-1',
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
        callbackId: 'observe-value',
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
        callbackId: 'observe-value',
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
        callbackId: 'observe-other-value',
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
        nodeId: 'effect-1',
        callbackId: 'observe-value',
      },
      expect: [],
      reject: {
        reason: 'Reactive graph graph-1 is disposed',
      },
    },
  )

export default createReactiveEffectSpec
