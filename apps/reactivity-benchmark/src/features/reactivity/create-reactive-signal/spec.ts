import { createCommandSlice, event } from '@specter-ts/spec'

export const createReactiveSignalSpec = createCommandSlice(
  'createReactiveSignal',
)
  .description(
    'Creates a writable reactive signal in a graph and associates its creation with a build batch.',
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
        batchId: 'build-2',
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
        batchId: 'build-2',
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
