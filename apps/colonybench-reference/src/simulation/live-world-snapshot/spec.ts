import { createQuerySlice, event } from '@specter-ts/spec'

const initialized = { runId: 'run-1' }
const moved = {
  runId: 'run-1',
  workerId: 'worker-1',
  from: { x: 0, y: 1 },
  to: { x: 1, y: 1 },
  target: { x: 2, y: 1 },
}
const harvested = {
  runId: 'run-1',
  workerId: 'worker-1',
  sourceId: 'source-1',
  amount: 5,
}
const deposited = { runId: 'run-1', workerId: 'worker-1', amount: 2 }
const upgraded = {
  runId: 'run-1',
  workerId: 'worker-1',
  amount: 1,
  level: 1,
  upgradeProgress: 1,
}
const spawned = {
  runId: 'run-1',
  workerId: 'worker-2',
  cost: 2,
  position: { x: 0, y: 0 },
}
const built = {
  runId: 'run-1',
  workerId: 'worker-1',
  siteId: 'road-site-1',
  amount: 1,
  progress: 1,
  completed: false,
}
const completed = {
  runId: 'run-1',
  siteId: 'road-site-1',
  roadId: 'road-1',
  position: { x: 1, y: 0 },
}
const repaired = {
  runId: 'run-1',
  workerId: 'worker-1',
  roadId: 'road-1',
  amount: 1,
  hits: 20,
}
const rejected = {
  runId: 'run-1',
  command: 'moveWorker',
  reason: 'terrain_wall',
}
const advanced = {
  runId: 'run-1',
  tick: 1,
  regeneratedSources: [{ sourceId: 'source-1', amount: 5, energy: 100 }],
  decayedRoads: [{ roadId: 'road-1', amount: 1, hits: 19 }],
}

export const liveWorldSnapshotSpec = createQuerySlice('liveWorldSnapshot')
  .description(
    'Returns the live ColonyBench world state and recent granular events.',
  )
  .scenarios(
    {
      description: 'Returns an empty snapshot for a missing world.',
      given: [],
      when: { runId: 'missing-run' },
      expect: {
        runId: 'missing-run',
        initialized: false,
        tick: 0,
        score: 0,
        base: null,
        controller: null,
        workers: [],
        sources: [],
        constructionSites: [],
        roads: [],
        terrain: [],
        recentEvents: [],
      },
    },
    {
      description:
        'Projects every simulation Event into an exact world snapshot.',
      given: [
        event('colonybench-simulation-initialized', initialized),
        event('colonybench-worker-moved', moved),
        event('colonybench-worker-harvested', harvested),
        event('colonybench-worker-deposited', deposited),
        event('colonybench-base-upgraded', upgraded),
        event('colonybench-worker-spawned', spawned),
        event('colonybench-construction-site-built', built),
        event('colonybench-road-completed', completed),
        event('colonybench-road-repaired', repaired),
        event('colonybench-command-rejected', rejected),
        event('colonybench-tick-advanced', advanced),
      ],
      when: { runId: 'run-1' },
      expect: {
        runId: 'run-1',
        initialized: true,
        tick: 1,
        score: 0,
        base: {
          id: 'base-1',
          position: { x: 0, y: 0 },
          energy: 0,
          level: 1,
          upgradeProgress: 1,
        },
        controller: {
          id: 'controller-1',
          position: { x: 0, y: -1 },
          level: 1,
          progress: 1,
          progressTotal: 10,
        },
        workers: [
          { id: 'worker-1', position: { x: 1, y: 1 }, energy: 0, capacity: 10 },
          { id: 'worker-2', position: { x: 0, y: 0 }, energy: 0, capacity: 10 },
        ],
        sources: [
          { id: 'source-1', position: { x: 2, y: 1 }, energy: 100 },
          { id: 'source-2', position: { x: -2, y: 0 }, energy: 100 },
        ],
        constructionSites: [],
        roads: [
          { id: 'road-1', position: { x: 1, y: 0 }, hits: 19, hitsMax: 20 },
        ],
        terrain: [{ id: 'wall-1', position: { x: -1, y: 1 }, terrain: 'wall' }],
        recentEvents: [
          { type: 'colonybench-simulation-initialized', payload: initialized },
          { type: 'colonybench-worker-moved', payload: moved },
          { type: 'colonybench-worker-harvested', payload: harvested },
          { type: 'colonybench-worker-deposited', payload: deposited },
          { type: 'colonybench-base-upgraded', payload: upgraded },
          { type: 'colonybench-worker-spawned', payload: spawned },
          { type: 'colonybench-construction-site-built', payload: built },
          { type: 'colonybench-road-completed', payload: completed },
          { type: 'colonybench-road-repaired', payload: repaired },
          { type: 'colonybench-command-rejected', payload: rejected },
          { type: 'colonybench-tick-advanced', payload: advanced },
        ],
      },
    },
  )

export default liveWorldSnapshotSpec
