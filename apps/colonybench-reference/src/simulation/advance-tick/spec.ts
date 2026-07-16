import { createCommandSlice, event } from '@specter-ts/core/spec'

import { lifecyclePayloads as lifecycle } from '../scenario-payloads'

export const advanceTickSpec = createCommandSlice('advanceTick')
  .description('Advances a simulation world tick counter.')
  .scenarios(
    {
      description:
        'Regenerates depleted sources and decays roads on the next tick.',
      given: [
        event('colonybench-simulation-initialized', { runId: 'run-1' }),
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
      ],
      when: { runId: 'run-1' },
      expect: [
        event('colonybench-tick-advanced', {
          runId: 'run-1',
          tick: 1,
          regeneratedSources: [{ sourceId: 'source-1', amount: 2, energy: 97 }],
          decayedRoads: [{ roadId: 'road-1', amount: 1, hits: 19 }],
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
      when: { runId: 'missing-run' },
      expect: [
        event('colonybench-command-rejected', {
          runId: 'missing-run',
          command: 'advanceTick',
          reason: 'world_missing',
        }),
      ],
    },
    {
      description: 'Advances from the tick established by a prior advance.',
      given: [
        event('colonybench-simulation-initialized', { runId: 'run-1' }),
        event('colonybench-tick-advanced', {
          runId: 'run-1',
          tick: 4,
          regeneratedSources: [],
          decayedRoads: [],
        }),
      ],
      when: { runId: 'run-1' },
      expect: [
        event('colonybench-tick-advanced', {
          runId: 'run-1',
          tick: 5,
          regeneratedSources: [],
          decayedRoads: [],
        }),
      ],
    },
  )
