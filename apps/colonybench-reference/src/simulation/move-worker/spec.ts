import { createCommandSlice, event } from '@specter-ts/core/spec'

import { lifecyclePayloads as lifecycle } from '../scenario-payloads'

export const moveWorkerSpec = createCommandSlice('moveWorker')
  .description(
    'Moves a worker one deterministic step toward a target position.',
  )
  .scenarios(
    {
      description: 'Moves the initial worker one step toward its target.',
      given: [event('colonybench-simulation-initialized', { runId: 'run-1' })],
      when: { runId: 'run-1', workerId: 'worker-1', target: { x: 2, y: 1 } },
      expect: [
        event('colonybench-worker-moved', {
          runId: 'run-1',
          workerId: 'worker-1',
          from: { x: 0, y: 1 },
          to: { x: 1, y: 1 },
          target: { x: 2, y: 1 },
        }),
      ],
    },
    {
      description: 'Records rejection when the world is missing.',
      given: [
        event('colonybench-simulation-initialized', lifecycle.initialized),
        event('colonybench-worker-moved', lifecycle.moved),
        event('colonybench-worker-harvested', lifecycle.harvested),
        event('colonybench-worker-deposited', lifecycle.deposited),
        event('colonybench-base-upgraded', lifecycle.upgraded),
        event('colonybench-worker-spawned', lifecycle.spawned),
        event('colonybench-construction-site-built', lifecycle.built),
        event('colonybench-road-completed', lifecycle.completed),
        event('colonybench-road-repaired', lifecycle.repaired),
        event('colonybench-command-rejected', lifecycle.rejected),
        event('colonybench-tick-advanced', lifecycle.advanced),
      ],
      when: {
        runId: 'missing-run',
        workerId: 'worker-1',
        target: { x: 2, y: 1 },
      },
      expect: [
        event('colonybench-command-rejected', {
          runId: 'missing-run',
          command: 'moveWorker',
          reason: 'world_missing',
        }),
      ],
    },
    {
      description:
        'Continues from the worker position established by a prior move.',
      given: [
        event('colonybench-simulation-initialized', { runId: 'run-1' }),
        event('colonybench-worker-moved', {
          runId: 'run-1',
          workerId: 'worker-1',
          from: { x: 0, y: 1 },
          to: { x: 1, y: 1 },
          target: { x: 2, y: 1 },
        }),
      ],
      when: { runId: 'run-1', workerId: 'worker-1', target: { x: 2, y: 1 } },
      expect: [
        event('colonybench-worker-moved', {
          runId: 'run-1',
          workerId: 'worker-1',
          from: { x: 1, y: 1 },
          to: { x: 2, y: 1 },
          target: { x: 2, y: 1 },
        }),
      ],
    },
  )
