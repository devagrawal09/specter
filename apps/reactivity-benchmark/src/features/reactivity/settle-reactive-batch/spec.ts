import { createCommandSlice, event } from '@specter-ts/spec'

export const settleReactiveBatchSpec = createCommandSlice('settleReactiveBatch')
  .description(
    'Synchronously settles one build or update batch with push-based, glitch-free computation and effect execution.',
  )
  .scenarios(
    {
      description:
        'Initializes computations before executing effects during a build.',
      given: [
        event('reactive-signal-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'signal-1',
          value: 2,
        }),
        event('reactive-computation-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'computed-1',
          callbackId: 'double-signal-1',
        }),
        event('reactive-effect-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'effect-1',
          callbackId: 'observe-computed-1',
        }),
      ],
      when: {
        graphId: 'graph-1',
        batchId: 'build-1',
      },
      expect: [
        event('reactive-computation-evaluated', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'computed-1',
          value: 4,
          dependencyNodeIds: ['signal-1'],
          changed: true,
        }),
        event('reactive-effect-executed', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'effect-1',
          dependencyNodeIds: ['computed-1'],
        }),
        event('reactive-batch-settled', {
          graphId: 'graph-1',
          batchId: 'build-1',
          evaluatedComputationCount: 1,
          executedEffectCount: 1,
        }),
      ],
    },
    {
      description:
        'Coalesces multiple writes and evaluates dependents once from final signal values.',
      given: [
        event('reactive-signal-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'left',
          value: 1,
        }),
        event('reactive-signal-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'right',
          value: 2,
        }),
        event('reactive-computation-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'sum',
          callbackId: 'sum-left-right',
        }),
        event('reactive-computation-evaluated', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'sum',
          value: 3,
          dependencyNodeIds: ['left', 'right'],
          changed: true,
        }),
        event('reactive-batch-settled', {
          graphId: 'graph-1',
          batchId: 'build-1',
          evaluatedComputationCount: 1,
          executedEffectCount: 0,
        }),
        event('reactive-signal-written', {
          graphId: 'graph-1',
          batchId: 'update-1',
          nodeId: 'left',
          previousValue: 1,
          value: 3,
          changed: true,
        }),
        event('reactive-signal-written', {
          graphId: 'graph-1',
          batchId: 'update-1',
          nodeId: 'right',
          previousValue: 2,
          value: 4,
          changed: true,
        }),
      ],
      when: {
        graphId: 'graph-1',
        batchId: 'update-1',
      },
      expect: [
        event('reactive-computation-evaluated', {
          graphId: 'graph-1',
          batchId: 'update-1',
          nodeId: 'sum',
          value: 7,
          dependencyNodeIds: ['left', 'right'],
          changed: true,
        }),
        event('reactive-batch-settled', {
          graphId: 'graph-1',
          batchId: 'update-1',
          evaluatedComputationCount: 1,
          executedEffectCount: 0,
        }),
      ],
    },
    {
      description:
        'Settles a diamond in topological order and executes its effect once.',
      given: [
        event('reactive-signal-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'head',
          value: 1,
        }),
        event('reactive-computation-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'left',
          callbackId: 'head-plus-one',
        }),
        event('reactive-computation-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'right',
          callbackId: 'head-times-two',
        }),
        event('reactive-computation-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'sum',
          callbackId: 'sum-left-right',
        }),
        event('reactive-effect-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'effect-1',
          callbackId: 'observe-sum',
        }),
        event('reactive-computation-evaluated', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'left',
          value: 2,
          dependencyNodeIds: ['head'],
          changed: true,
        }),
        event('reactive-computation-evaluated', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'right',
          value: 2,
          dependencyNodeIds: ['head'],
          changed: true,
        }),
        event('reactive-computation-evaluated', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'sum',
          value: 4,
          dependencyNodeIds: ['left', 'right'],
          changed: true,
        }),
        event('reactive-effect-executed', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'effect-1',
          dependencyNodeIds: ['sum'],
        }),
        event('reactive-batch-settled', {
          graphId: 'graph-1',
          batchId: 'build-1',
          evaluatedComputationCount: 3,
          executedEffectCount: 1,
        }),
        event('reactive-signal-written', {
          graphId: 'graph-1',
          batchId: 'update-1',
          nodeId: 'head',
          previousValue: 1,
          value: 2,
          changed: true,
        }),
      ],
      when: {
        graphId: 'graph-1',
        batchId: 'update-1',
      },
      expect: [
        event('reactive-computation-evaluated', {
          graphId: 'graph-1',
          batchId: 'update-1',
          nodeId: 'left',
          value: 3,
          dependencyNodeIds: ['head'],
          changed: true,
        }),
        event('reactive-computation-evaluated', {
          graphId: 'graph-1',
          batchId: 'update-1',
          nodeId: 'right',
          value: 4,
          dependencyNodeIds: ['head'],
          changed: true,
        }),
        event('reactive-computation-evaluated', {
          graphId: 'graph-1',
          batchId: 'update-1',
          nodeId: 'sum',
          value: 7,
          dependencyNodeIds: ['left', 'right'],
          changed: true,
        }),
        event('reactive-effect-executed', {
          graphId: 'graph-1',
          batchId: 'update-1',
          nodeId: 'effect-1',
          dependencyNodeIds: ['sum'],
        }),
        event('reactive-batch-settled', {
          graphId: 'graph-1',
          batchId: 'update-1',
          evaluatedComputationCount: 3,
          executedEffectCount: 1,
        }),
      ],
    },
    {
      description:
        'Stops propagation when an evaluated computation keeps an equal value.',
      given: [
        event('reactive-signal-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'head',
          value: 1,
        }),
        event('reactive-computation-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'constant',
          callbackId: 'constant-zero-from-head',
        }),
        event('reactive-computation-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'downstream',
          callbackId: 'expensive-constant-plus-one',
        }),
        event('reactive-effect-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'effect-1',
          callbackId: 'observe-downstream',
        }),
        event('reactive-computation-evaluated', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'constant',
          value: 0,
          dependencyNodeIds: ['head'],
          changed: true,
        }),
        event('reactive-computation-evaluated', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'downstream',
          value: 1,
          dependencyNodeIds: ['constant'],
          changed: true,
        }),
        event('reactive-effect-executed', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'effect-1',
          dependencyNodeIds: ['downstream'],
        }),
        event('reactive-batch-settled', {
          graphId: 'graph-1',
          batchId: 'build-1',
          evaluatedComputationCount: 2,
          executedEffectCount: 1,
        }),
        event('reactive-signal-written', {
          graphId: 'graph-1',
          batchId: 'update-1',
          nodeId: 'head',
          previousValue: 1,
          value: 2,
          changed: true,
        }),
      ],
      when: {
        graphId: 'graph-1',
        batchId: 'update-1',
      },
      expect: [
        event('reactive-computation-evaluated', {
          graphId: 'graph-1',
          batchId: 'update-1',
          nodeId: 'constant',
          value: 0,
          dependencyNodeIds: ['head'],
          changed: false,
        }),
        event('reactive-batch-settled', {
          graphId: 'graph-1',
          batchId: 'update-1',
          evaluatedComputationCount: 1,
          executedEffectCount: 0,
        }),
      ],
    },
    {
      description:
        'Tracks switched dynamic dependencies and ignores a stale dependency.',
      given: [
        event('reactive-signal-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'selector',
          value: false,
        }),
        event('reactive-signal-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'left',
          value: 10,
        }),
        event('reactive-signal-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'right',
          value: 20,
        }),
        event('reactive-computation-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'selected',
          callbackId: 'select-left-or-right',
        }),
        event('reactive-computation-evaluated', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'selected',
          value: 10,
          dependencyNodeIds: ['selector', 'left'],
          changed: true,
        }),
        event('reactive-batch-settled', {
          graphId: 'graph-1',
          batchId: 'build-1',
          evaluatedComputationCount: 1,
          executedEffectCount: 0,
        }),
        event('reactive-signal-written', {
          graphId: 'graph-1',
          batchId: 'update-1',
          nodeId: 'selector',
          previousValue: false,
          value: true,
          changed: true,
        }),
        event('reactive-computation-evaluated', {
          graphId: 'graph-1',
          batchId: 'update-1',
          nodeId: 'selected',
          value: 20,
          dependencyNodeIds: ['selector', 'right'],
          changed: true,
        }),
        event('reactive-batch-settled', {
          graphId: 'graph-1',
          batchId: 'update-1',
          evaluatedComputationCount: 1,
          executedEffectCount: 0,
        }),
        event('reactive-signal-written', {
          graphId: 'graph-1',
          batchId: 'update-2',
          nodeId: 'left',
          previousValue: 10,
          value: 11,
          changed: true,
        }),
      ],
      when: {
        graphId: 'graph-1',
        batchId: 'update-2',
      },
      expect: [
        event('reactive-batch-settled', {
          graphId: 'graph-1',
          batchId: 'update-2',
          evaluatedComputationCount: 0,
          executedEffectCount: 0,
        }),
      ],
    },
    {
      description: 'Deduplicates repeated reads of the same dependency.',
      given: [
        event('reactive-signal-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'head',
          value: 2,
        }),
        event('reactive-computation-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'repeated',
          callbackId: 'read-head-three-times',
        }),
      ],
      when: {
        graphId: 'graph-1',
        batchId: 'build-1',
      },
      expect: [
        event('reactive-computation-evaluated', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'repeated',
          value: 6,
          dependencyNodeIds: ['head'],
          changed: true,
        }),
        event('reactive-batch-settled', {
          graphId: 'graph-1',
          batchId: 'build-1',
          evaluatedComputationCount: 1,
          executedEffectCount: 0,
        }),
      ],
    },
    {
      description: 'Skips propagation when a batch has no net value change.',
      given: [
        event('reactive-signal-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'head',
          value: 1,
        }),
        event('reactive-computation-created', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'double',
          callbackId: 'double-head',
        }),
        event('reactive-computation-evaluated', {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'double',
          value: 2,
          dependencyNodeIds: ['head'],
          changed: true,
        }),
        event('reactive-batch-settled', {
          graphId: 'graph-1',
          batchId: 'build-1',
          evaluatedComputationCount: 1,
          executedEffectCount: 0,
        }),
        event('reactive-signal-written', {
          graphId: 'graph-1',
          batchId: 'update-1',
          nodeId: 'head',
          previousValue: 1,
          value: 2,
          changed: true,
        }),
        event('reactive-signal-written', {
          graphId: 'graph-1',
          batchId: 'update-1',
          nodeId: 'head',
          previousValue: 2,
          value: 1,
          changed: true,
        }),
      ],
      when: {
        graphId: 'graph-1',
        batchId: 'update-1',
      },
      expect: [
        event('reactive-batch-settled', {
          graphId: 'graph-1',
          batchId: 'update-1',
          evaluatedComputationCount: 0,
          executedEffectCount: 0,
        }),
      ],
    },
    {
      description: 'Rejects a batch that has already settled.',
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
      },
      expect: [],
      reject: {
        reason: 'Reactive batch build-1 is already settled in graph graph-1',
      },
    },
    {
      description: 'Rejects settlement in a disposed graph.',
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
        batchId: 'build-1',
      },
      expect: [],
      reject: {
        reason: 'Reactive graph graph-1 is disposed',
      },
    },
  )

export default settleReactiveBatchSpec
