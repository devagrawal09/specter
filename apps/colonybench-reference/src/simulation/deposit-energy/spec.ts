import { createCommandSlice, event } from '@specter-ts/core/spec'

import { lifecyclePayloads as lifecycle } from '../scenario-payloads'

export const depositEnergySpec = createCommandSlice('depositEnergy')
  .description('Deposits a worker carried energy into an adjacent base.')
  .scenarios(
    {
      description: 'Deposits all energy carried by the initial worker.',
      given: [
        event('colonybench-simulation-initialized', { runId: 'run-1' }),
        event('colonybench-worker-harvested', {
          runId: 'run-1',
          workerId: 'worker-1',
          sourceId: 'source-1',
          amount: 5,
        }),
      ],
      when: { runId: 'run-1', workerId: 'worker-1' },
      expect: [
        event('colonybench-worker-deposited', {
          runId: 'run-1',
          workerId: 'worker-1',
          amount: 5,
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
          command: 'depositEnergy',
          reason: 'world_missing',
        }),
      ],
    },
    {
      description: 'Deposits newly harvested energy after a prior deposit.',
      given: [
        event('colonybench-simulation-initialized', { runId: 'run-1' }),
        event('colonybench-worker-harvested', {
          runId: 'run-1',
          workerId: 'worker-1',
          sourceId: 'source-1',
          amount: 5,
        }),
        event('colonybench-worker-deposited', {
          runId: 'run-1',
          workerId: 'worker-1',
          amount: 5,
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
        event('colonybench-worker-deposited', {
          runId: 'run-1',
          workerId: 'worker-1',
          amount: 5,
        }),
      ],
    },
  )
