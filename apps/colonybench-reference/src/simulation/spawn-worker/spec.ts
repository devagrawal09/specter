import { createCommandSlice, event } from '@specter-ts/core/spec'

import { lifecyclePayloads as lifecycle } from '../scenario-payloads'

export const spawnWorkerSpec = createCommandSlice('spawnWorker')
  .description('Spawns a worker with an explicit ID by spending base energy.')
  .scenarios(
    {
      description:
        'Spawns the supplied worker after enough energy is deposited.',
      given: [
        event('colonybench-simulation-initialized', { runId: 'run-1' }),
        event('colonybench-worker-harvested', {
          runId: 'run-1',
          workerId: 'worker-1',
          sourceId: 'source-1',
          amount: 10,
        }),
        event('colonybench-worker-deposited', {
          runId: 'run-1',
          workerId: 'worker-1',
          amount: 10,
        }),
      ],
      when: { runId: 'run-1', workerId: 'worker-2' },
      expect: [
        event('colonybench-worker-spawned', {
          runId: 'run-1',
          workerId: 'worker-2',
          cost: 10,
          position: { x: 0, y: 0 },
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
      when: { runId: 'missing-run', workerId: 'worker-2' },
      expect: [
        event('colonybench-command-rejected', {
          runId: 'missing-run',
          command: 'spawnWorker',
          reason: 'world_missing',
        }),
      ],
    },
    {
      description:
        'Records rejection when the supplied worker ID already exists.',
      given: [
        event('colonybench-simulation-initialized', { runId: 'run-1' }),
        event('colonybench-worker-harvested', {
          runId: 'run-1',
          workerId: 'worker-1',
          sourceId: 'source-1',
          amount: 10,
        }),
        event('colonybench-worker-deposited', {
          runId: 'run-1',
          workerId: 'worker-1',
          amount: 10,
        }),
        event('colonybench-worker-spawned', {
          runId: 'run-1',
          workerId: 'worker-2',
          cost: 10,
          position: { x: 0, y: 0 },
        }),
        event('colonybench-worker-harvested', {
          runId: 'run-1',
          workerId: 'worker-1',
          sourceId: 'source-1',
          amount: 10,
        }),
        event('colonybench-worker-deposited', {
          runId: 'run-1',
          workerId: 'worker-1',
          amount: 10,
        }),
      ],
      when: { runId: 'run-1', workerId: 'worker-2' },
      expect: [
        event('colonybench-command-rejected', {
          runId: 'run-1',
          command: 'spawnWorker',
          reason: 'worker_exists',
        }),
      ],
    },
  )
