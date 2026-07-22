import { createCommandSlice, event } from '@specter-ts/spec'

import { lifecyclePayloads as lifecycle } from '../scenario-payloads.ts'

export const upgradeBaseSpec = createCommandSlice('upgradeBase')
  .description('Consumes adjacent worker energy as base upgrade progress.')
  .scenarios(
    {
      description: 'Adds carried energy to controller progress.',
      given: [
        event('colonybench-simulation-initialized', { runId: 'run-1' }),
        event('colonybench-worker-moved', {
          runId: 'run-1',
          workerId: 'worker-1',
          from: { x: 0, y: 1 },
          to: { x: 0, y: 0 },
          target: { x: 0, y: -1 },
        }),
        event('colonybench-worker-harvested', {
          runId: 'run-1',
          workerId: 'worker-1',
          sourceId: 'source-1',
          amount: 5,
        }),
      ],
      when: { runId: 'run-1', workerId: 'worker-1' },
      expect: [
        event('colonybench-base-upgraded', {
          runId: 'run-1',
          workerId: 'worker-1',
          amount: 5,
          level: 1,
          upgradeProgress: 5,
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
      when: { runId: 'missing-run', workerId: 'worker-1' },
      expect: [
        event('colonybench-command-rejected', {
          runId: 'missing-run',
          command: 'upgradeBase',
          reason: 'world_missing',
        }),
      ],
    },
    {
      description: 'Completes an upgrade from prior controller progress.',
      given: [
        event('colonybench-simulation-initialized', { runId: 'run-1' }),
        event('colonybench-worker-moved', {
          runId: 'run-1',
          workerId: 'worker-1',
          from: { x: 0, y: 1 },
          to: { x: 0, y: 0 },
          target: { x: 0, y: -1 },
        }),
        event('colonybench-worker-harvested', {
          runId: 'run-1',
          workerId: 'worker-1',
          sourceId: 'source-1',
          amount: 10,
        }),
        event('colonybench-base-upgraded', {
          runId: 'run-1',
          workerId: 'worker-1',
          amount: 5,
          level: 1,
          upgradeProgress: 5,
        }),
      ],
      when: { runId: 'run-1', workerId: 'worker-1' },
      expect: [
        event('colonybench-base-upgraded', {
          runId: 'run-1',
          workerId: 'worker-1',
          amount: 5,
          level: 2,
          upgradeProgress: 0,
        }),
      ],
    },
  )

export default upgradeBaseSpec
