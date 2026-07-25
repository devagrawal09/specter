import { createCommandSlice, event } from '@specter-ts/spec'

export const createReactiveEffectSpec = createCommandSlice(
  'createReactiveEffect',
)
  .description(
    'Creates an effect node whose runtime-owned callback is identified by a portable callback ID.',
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
        batchId: 'build-2',
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
        batchId: 'build-2',
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
        batchId: 'build-2',
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
