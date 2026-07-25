import { createCommandSlice, event } from '@specter-ts/spec'

export const disposeReactiveGraphSpec = createCommandSlice(
  'disposeReactiveGraph',
)
  .description(
    'Disposes a reactive graph so its nodes and runtime-owned callbacks can be released.',
  )
  .scenarios(
    {
      description: 'Disposes a graph containing a signal.',
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
      },
      expect: [
        event('reactive-graph-disposed', {
          graphId: 'graph-1',
        }),
      ],
    },
    {
      description: 'Disposes a graph containing a computation.',
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
      },
      expect: [
        event('reactive-graph-disposed', {
          graphId: 'graph-1',
        }),
      ],
    },
    {
      description: 'Disposes a graph containing an effect.',
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
      },
      expect: [
        event('reactive-graph-disposed', {
          graphId: 'graph-1',
        }),
      ],
    },
    {
      description: 'Rejects disposal of an unknown graph.',
      given: [],
      when: {
        graphId: 'missing',
      },
      expect: [],
      reject: {
        reason: 'Reactive graph missing was not found',
      },
    },
    {
      description: 'Rejects disposal of an already-disposed graph.',
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
      },
      expect: [],
      reject: {
        reason: 'Reactive graph graph-1 is already disposed',
      },
    },
  )

export default disposeReactiveGraphSpec
