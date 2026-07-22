import { createCommandSlice, event } from '@specter-ts/spec'

import { lifecyclePayloads as lifecycle } from '../scenario-payloads.ts'

export const repairRoadSpec = createCommandSlice('repairRoad')
  .description('Repairs an adjacent damaged road with carried worker energy.')
  .scenarios(
    {
      description: 'Repairs a damaged road with carried worker energy.',
      given: [
        event('colonybench-simulation-initialized', { runId: 'run-1' }),
        event('colonybench-worker-moved', {
          runId: 'run-1',
          workerId: 'worker-1',
          from: { x: 0, y: 1 },
          to: { x: 1, y: 1 },
          target: { x: 1, y: 0 },
        }),
        event('colonybench-worker-harvested', {
          runId: 'run-1',
          workerId: 'worker-1',
          sourceId: 'source-1',
          amount: 5,
        }),
        event('colonybench-road-completed', {
          runId: 'run-1',
          siteId: 'road-site-1',
          roadId: 'road-1',
          position: { x: 1, y: 0 },
        }),
        event('colonybench-tick-advanced', {
          runId: 'run-1',
          tick: 1,
          regeneratedSources: [],
          decayedRoads: [{ roadId: 'road-1', amount: 5, hits: 15 }],
        }),
      ],
      when: { runId: 'run-1', workerId: 'worker-1', roadId: 'road-1' },
      expect: [
        event('colonybench-road-repaired', {
          runId: 'run-1',
          workerId: 'worker-1',
          roadId: 'road-1',
          amount: 5,
          hits: 20,
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
      when: { runId: 'missing-run', workerId: 'worker-1', roadId: 'road-1' },
      expect: [
        event('colonybench-command-rejected', {
          runId: 'missing-run',
          command: 'repairRoad',
          reason: 'world_missing',
        }),
      ],
    },
    {
      description: 'Records rejection when a prior repair restored full hits.',
      given: [
        event('colonybench-simulation-initialized', { runId: 'run-1' }),
        event('colonybench-worker-moved', {
          runId: 'run-1',
          workerId: 'worker-1',
          from: { x: 0, y: 1 },
          to: { x: 1, y: 1 },
          target: { x: 1, y: 0 },
        }),
        event('colonybench-worker-harvested', {
          runId: 'run-1',
          workerId: 'worker-1',
          sourceId: 'source-1',
          amount: 10,
        }),
        event('colonybench-road-completed', {
          runId: 'run-1',
          siteId: 'road-site-1',
          roadId: 'road-1',
          position: { x: 1, y: 0 },
        }),
        event('colonybench-tick-advanced', {
          runId: 'run-1',
          tick: 1,
          regeneratedSources: [],
          decayedRoads: [{ roadId: 'road-1', amount: 5, hits: 15 }],
        }),
        event('colonybench-road-repaired', {
          runId: 'run-1',
          workerId: 'worker-1',
          roadId: 'road-1',
          amount: 5,
          hits: 20,
        }),
      ],
      when: { runId: 'run-1', workerId: 'worker-1', roadId: 'road-1' },
      expect: [
        event('colonybench-command-rejected', {
          runId: 'run-1',
          command: 'repairRoad',
          reason: 'road_full_hits',
        }),
      ],
    },
  )

export default repairRoadSpec
