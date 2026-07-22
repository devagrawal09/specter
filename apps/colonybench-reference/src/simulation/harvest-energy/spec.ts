import { createCommandSlice, event } from '@specter-ts/spec'

import { lifecyclePayloads as lifecycle } from '../scenario-payloads.ts'

export const harvestEnergySpec = createCommandSlice('harvestEnergy')
  .description('Harvests energy from an adjacent source into a worker.')
  .scenarios(
    {
      description: 'Harvests five energy after the worker approaches a source.',
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
      when: { runId: 'run-1', workerId: 'worker-1', sourceId: 'source-1' },
      expect: [
        event('colonybench-worker-harvested', {
          runId: 'run-1',
          workerId: 'worker-1',
          sourceId: 'source-1',
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
      when: {
        runId: 'missing-run',
        workerId: 'worker-1',
        sourceId: 'source-1',
      },
      expect: [
        event('colonybench-command-rejected', {
          runId: 'missing-run',
          command: 'harvestEnergy',
          reason: 'world_missing',
        }),
      ],
    },
    {
      description:
        'Harvests again using prior carried energy and source depletion.',
      given: [
        event('colonybench-simulation-initialized', { runId: 'run-1' }),
        event('colonybench-worker-moved', {
          runId: 'run-1',
          workerId: 'worker-1',
          from: { x: 0, y: 1 },
          to: { x: 1, y: 1 },
          target: { x: 2, y: 1 },
        }),
        event('colonybench-worker-harvested', {
          runId: 'run-1',
          workerId: 'worker-1',
          sourceId: 'source-1',
          amount: 5,
        }),
      ],
      when: { runId: 'run-1', workerId: 'worker-1', sourceId: 'source-1' },
      expect: [
        event('colonybench-worker-harvested', {
          runId: 'run-1',
          workerId: 'worker-1',
          sourceId: 'source-1',
          amount: 5,
        }),
      ],
    },
  )

export default harvestEnergySpec
