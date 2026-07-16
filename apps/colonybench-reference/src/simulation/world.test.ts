import { describe, expect, test } from 'vitest'

import {
  createColonyBenchSimulationApp,
  createMemoryColonyBenchSimulationAdapters,
} from '../index'

function createSimulationApp() {
  return createColonyBenchSimulationApp({
    adapters: createMemoryColonyBenchSimulationAdapters(),
  })
}

function lastRecentEvent(snapshot: {
  recentEvents: { type: string; payload: unknown }[]
}) {
  return snapshot.recentEvents[snapshot.recentEvents.length - 1]
}

describe('ColonyBench v0 simulation world', () => {
  test('initializeSimulation creates a deterministic tick 0 world', async () => {
    const simulationApp = await createSimulationApp()

    await simulationApp.command({
      type: 'initializeSimulation',
      payload: { runId: 'sim-init' },
    })

    await expect(
      simulationApp.query({
        type: 'liveWorldSnapshot',
        payload: { runId: 'sim-init' },
      }),
    ).resolves.toMatchObject({
      runId: 'sim-init',
      initialized: true,
      tick: 0,
      score: 0,
      base: {
        id: 'base-1',
        position: { x: 0, y: 0 },
        energy: 0,
        level: 1,
        upgradeProgress: 0,
      },
      workers: [
        {
          id: 'worker-1',
          position: { x: 0, y: 1 },
          energy: 0,
          capacity: 10,
        },
      ],
      sources: [
        { id: 'source-1', position: { x: 2, y: 1 }, energy: 100 },
        { id: 'source-2', position: { x: -2, y: 0 }, energy: 100 },
      ],
      recentEvents: [
        {
          type: 'colonybench-simulation-initialized',
          payload: { runId: 'sim-init' },
        },
      ],
    })
  })

  test('initial world exposes a separate room controller for Screeps-like upgrading', async () => {
    const simulationApp = await createSimulationApp()

    await simulationApp.command({
      type: 'initializeSimulation',
      payload: { runId: 'sim-controller' },
    })

    await expect(
      simulationApp.query({
        type: 'liveWorldSnapshot',
        payload: { runId: 'sim-controller' },
      }),
    ).resolves.toMatchObject({
      controller: {
        id: 'controller-1',
        position: { x: 0, y: -1 },
        level: 1,
        progress: 0,
        progressTotal: 10,
      },
    })
  })

  test('moveWorker rejects a step into wall terrain and leaves the worker in place', async () => {
    const simulationApp = await createSimulationApp()
    await simulationApp.command({
      type: 'initializeSimulation',
      payload: { runId: 'sim-wall' },
    })

    await simulationApp.command({
      type: 'moveWorker',
      payload: {
        runId: 'sim-wall',
        workerId: 'worker-1',
        target: { x: -1, y: 1 },
      },
    })

    const snapshot = await simulationApp.query({
      type: 'liveWorldSnapshot',
      payload: {
        runId: 'sim-wall',
      },
    })
    expect(snapshot.terrain).toEqual([
      { id: 'wall-1', position: { x: -1, y: 1 }, terrain: 'wall' },
    ])
    expect(snapshot.workers[0]).toMatchObject({
      id: 'worker-1',
      position: { x: 0, y: 1 },
    })
    expect(lastRecentEvent(snapshot)).toMatchObject({
      type: 'colonybench-command-rejected',
      payload: {
        runId: 'sim-wall',
        command: 'moveWorker',
        reason: 'terrain_wall',
      },
    })
  })

  test('moveWorker emits WorkerMoved and moves one step toward the target', async () => {
    const simulationApp = await createSimulationApp()
    await simulationApp.command({
      type: 'initializeSimulation',
      payload: { runId: 'sim-move' },
    })

    await simulationApp.command({
      type: 'moveWorker',
      payload: {
        runId: 'sim-move',
        workerId: 'worker-1',
        target: { x: 2, y: 1 },
      },
    })

    const snapshot = await simulationApp.query({
      type: 'liveWorldSnapshot',
      payload: {
        runId: 'sim-move',
      },
    })
    expect(snapshot.workers[0]).toMatchObject({
      id: 'worker-1',
      position: { x: 1, y: 1 },
    })
    expect(lastRecentEvent(snapshot)).toMatchObject({
      type: 'colonybench-worker-moved',
      payload: {
        runId: 'sim-move',
        workerId: 'worker-1',
        from: { x: 0, y: 1 },
        to: { x: 1, y: 1 },
        target: { x: 2, y: 1 },
      },
    })
  })

  test('harvestEnergy requires adjacency; success transfers energy from source to worker', async () => {
    const simulationApp = await createSimulationApp()
    await simulationApp.command({
      type: 'initializeSimulation',
      payload: { runId: 'sim-harvest' },
    })

    await simulationApp.command({
      type: 'harvestEnergy',
      payload: {
        runId: 'sim-harvest',
        workerId: 'worker-1',
        sourceId: 'source-1',
      },
    })

    let snapshot = await simulationApp.query({
      type: 'liveWorldSnapshot',
      payload: {
        runId: 'sim-harvest',
      },
    })
    expect(snapshot.workers[0]).toMatchObject({ energy: 0 })
    expect(snapshot.sources[0]).toMatchObject({ energy: 100 })
    expect(lastRecentEvent(snapshot)).toMatchObject({
      type: 'colonybench-command-rejected',
      payload: {
        runId: 'sim-harvest',
        command: 'harvestEnergy',
        reason: 'worker_not_adjacent_to_source',
      },
    })

    await simulationApp.command({
      type: 'moveWorker',
      payload: {
        runId: 'sim-harvest',
        workerId: 'worker-1',
        target: { x: 2, y: 1 },
      },
    })
    await simulationApp.command({
      type: 'harvestEnergy',
      payload: {
        runId: 'sim-harvest',
        workerId: 'worker-1',
        sourceId: 'source-1',
      },
    })

    snapshot = await simulationApp.query({
      type: 'liveWorldSnapshot',
      payload: { runId: 'sim-harvest' },
    })
    expect(snapshot.workers[0]).toMatchObject({ energy: 5 })
    expect(snapshot.sources[0]).toMatchObject({ energy: 95 })
    expect(lastRecentEvent(snapshot)).toMatchObject({
      type: 'colonybench-worker-harvested',
      payload: {
        runId: 'sim-harvest',
        workerId: 'worker-1',
        sourceId: 'source-1',
        amount: 5,
      },
    })
  })

  test('depositEnergy transfers carried energy into the adjacent base', async () => {
    const simulationApp = await createSimulationApp()
    await simulationApp.command({
      type: 'initializeSimulation',
      payload: { runId: 'sim-deposit' },
    })
    await simulationApp.command({
      type: 'moveWorker',
      payload: {
        runId: 'sim-deposit',
        workerId: 'worker-1',
        target: { x: 2, y: 1 },
      },
    })
    await simulationApp.command({
      type: 'harvestEnergy',
      payload: {
        runId: 'sim-deposit',
        workerId: 'worker-1',
        sourceId: 'source-1',
      },
    })
    await simulationApp.command({
      type: 'moveWorker',
      payload: {
        runId: 'sim-deposit',
        workerId: 'worker-1',
        target: { x: 0, y: 1 },
      },
    })

    await simulationApp.command({
      type: 'depositEnergy',
      payload: {
        runId: 'sim-deposit',
        workerId: 'worker-1',
      },
    })

    const snapshot = await simulationApp.query({
      type: 'liveWorldSnapshot',
      payload: {
        runId: 'sim-deposit',
      },
    })
    expect(snapshot.base).toMatchObject({ energy: 5 })
    expect(snapshot.workers[0]).toMatchObject({ energy: 0 })
    expect(lastRecentEvent(snapshot)).toMatchObject({
      type: 'colonybench-worker-deposited',
      payload: {
        runId: 'sim-deposit',
        workerId: 'worker-1',
        amount: 5,
      },
    })
  })

  test('upgradeBase consumes worker energy/progress and upgrades at the threshold', async () => {
    const simulationApp = await createSimulationApp()
    await simulationApp.command({
      type: 'initializeSimulation',
      payload: { runId: 'sim-upgrade' },
    })
    await simulationApp.command({
      type: 'moveWorker',
      payload: {
        runId: 'sim-upgrade',
        workerId: 'worker-1',
        target: { x: 2, y: 1 },
      },
    })
    await simulationApp.command({
      type: 'harvestEnergy',
      payload: {
        runId: 'sim-upgrade',
        workerId: 'worker-1',
        sourceId: 'source-1',
      },
    })
    await simulationApp.command({
      type: 'harvestEnergy',
      payload: {
        runId: 'sim-upgrade',
        workerId: 'worker-1',
        sourceId: 'source-1',
      },
    })
    await simulationApp.command({
      type: 'moveWorker',
      payload: {
        runId: 'sim-upgrade',
        workerId: 'worker-1',
        target: { x: 0, y: -1 },
      },
    })

    await simulationApp.command({
      type: 'upgradeBase',
      payload: {
        runId: 'sim-upgrade',
        workerId: 'worker-1',
      },
    })

    const snapshot = await simulationApp.query({
      type: 'liveWorldSnapshot',
      payload: {
        runId: 'sim-upgrade',
      },
    })
    expect(snapshot.base).toMatchObject({
      level: 2,
      upgradeProgress: 0,
    })
    expect(snapshot.workers[0]).toMatchObject({ energy: 0 })
    expect(snapshot.score).toBe(100)
    expect(lastRecentEvent(snapshot)).toMatchObject({
      type: 'colonybench-base-upgraded',
      payload: {
        runId: 'sim-upgrade',
        workerId: 'worker-1',
        amount: 10,
        level: 2,
      },
    })
  })

  test('spawnWorker spends base energy and creates deterministic worker IDs', async () => {
    const simulationApp = await createSimulationApp()
    await simulationApp.command({
      type: 'initializeSimulation',
      payload: { runId: 'sim-spawn' },
    })
    await simulationApp.command({
      type: 'moveWorker',
      payload: {
        runId: 'sim-spawn',
        workerId: 'worker-1',
        target: { x: 2, y: 1 },
      },
    })
    await simulationApp.command({
      type: 'harvestEnergy',
      payload: {
        runId: 'sim-spawn',
        workerId: 'worker-1',
        sourceId: 'source-1',
      },
    })
    await simulationApp.command({
      type: 'harvestEnergy',
      payload: {
        runId: 'sim-spawn',
        workerId: 'worker-1',
        sourceId: 'source-1',
      },
    })
    await simulationApp.command({
      type: 'moveWorker',
      payload: {
        runId: 'sim-spawn',
        workerId: 'worker-1',
        target: { x: 0, y: 1 },
      },
    })
    await simulationApp.command({
      type: 'depositEnergy',
      payload: {
        runId: 'sim-spawn',
        workerId: 'worker-1',
      },
    })

    await simulationApp.command({
      type: 'spawnWorker',
      payload: {
        runId: 'sim-spawn',
        workerId: 'worker-2',
      },
    })

    const snapshot = await simulationApp.query({
      type: 'liveWorldSnapshot',
      payload: {
        runId: 'sim-spawn',
      },
    })
    expect(snapshot.base).toMatchObject({ energy: 0 })
    expect(snapshot.workers).toEqual([
      expect.objectContaining({ id: 'worker-1' }),
      expect.objectContaining({
        id: 'worker-2',
        position: { x: 0, y: 0 },
        energy: 0,
        capacity: 10,
      }),
    ])
    expect(lastRecentEvent(snapshot)).toMatchObject({
      type: 'colonybench-worker-spawned',
      payload: { runId: 'sim-spawn', workerId: 'worker-2', cost: 10 },
    })
  })

  test('advanceTick regenerates depleted sources with a visible event summary', async () => {
    const simulationApp = await createSimulationApp()
    await simulationApp.command({
      type: 'initializeSimulation',
      payload: { runId: 'sim-regenerate' },
    })

    for (let count = 0; count < 20; count += 1) {
      await simulationApp.command({
        type: 'moveWorker',
        payload: {
          runId: 'sim-regenerate',
          workerId: 'worker-1',
          target: { x: 2, y: 1 },
        },
      })
      await simulationApp.command({
        type: 'harvestEnergy',
        payload: {
          runId: 'sim-regenerate',
          workerId: 'worker-1',
          sourceId: 'source-1',
        },
      })
      await simulationApp.command({
        type: 'moveWorker',
        payload: {
          runId: 'sim-regenerate',
          workerId: 'worker-1',
          target: { x: 0, y: -1 },
        },
      })
      await simulationApp.command({
        type: 'upgradeBase',
        payload: {
          runId: 'sim-regenerate',
          workerId: 'worker-1',
        },
      })
    }

    let snapshot = await simulationApp.query({
      type: 'liveWorldSnapshot',
      payload: {
        runId: 'sim-regenerate',
      },
    })
    expect(snapshot.sources[0]).toMatchObject({ id: 'source-1', energy: 0 })

    await simulationApp.command({
      type: 'advanceTick',
      payload: { runId: 'sim-regenerate' },
    })

    snapshot = await simulationApp.query({
      type: 'liveWorldSnapshot',
      payload: {
        runId: 'sim-regenerate',
      },
    })
    expect(snapshot.sources[0]).toMatchObject({ id: 'source-1', energy: 2 })
    expect(lastRecentEvent(snapshot)).toMatchObject({
      type: 'colonybench-tick-advanced',
      payload: {
        runId: 'sim-regenerate',
        tick: expect.any(Number),
        regeneratedSources: [{ sourceId: 'source-1', amount: 2, energy: 2 }],
      },
    })
  })

  test('liveWorldSnapshot subscriptions yield updated snapshots after granular events', async () => {
    const simulationApp = await createSimulationApp()
    const subscription = simulationApp
      .subscribe({
        type: 'liveWorldSnapshot',
        payload: {
          runId: 'sim-live',
        },
      })
      [Symbol.asyncIterator]()

    await expect(subscription.next()).resolves.toEqual({
      done: false,
      value: expect.objectContaining({
        runId: 'sim-live',
        initialized: false,
        tick: 0,
        score: 0,
        recentEvents: [],
      }),
    })

    await simulationApp.command({
      type: 'initializeSimulation',
      payload: { runId: 'sim-live' },
    })
    await expect(subscription.next()).resolves.toEqual({
      done: false,
      value: expect.objectContaining({
        initialized: true,
        workers: [expect.objectContaining({ id: 'worker-1' })],
        recentEvents: [
          expect.objectContaining({
            type: 'colonybench-simulation-initialized',
          }),
        ],
      }),
    })

    await simulationApp.command({
      type: 'moveWorker',
      payload: {
        runId: 'sim-live',
        workerId: 'worker-1',
        target: { x: 2, y: 1 },
      },
    })
    await expect(subscription.next()).resolves.toEqual({
      done: false,
      value: expect.objectContaining({
        workers: [
          expect.objectContaining({
            id: 'worker-1',
            position: { x: 1, y: 1 },
          }),
        ],
        recentEvents: expect.arrayContaining([
          expect.objectContaining({ type: 'colonybench-worker-moved' }),
        ]),
      }),
    })

    await subscription.return?.()
  })

  test('buildConstructionSite turns worker energy into road progress and completes roads', async () => {
    const simulationApp = await createSimulationApp()
    await simulationApp.command({
      type: 'initializeSimulation',
      payload: { runId: 'sim-build-road' },
    })

    let snapshot = await simulationApp.query({
      type: 'liveWorldSnapshot',
      payload: {
        runId: 'sim-build-road',
      },
    })
    expect(snapshot.constructionSites).toEqual([
      {
        id: 'road-site-1',
        structureType: 'road',
        position: { x: 1, y: 0 },
        progress: 0,
        progressTotal: 10,
      },
    ])
    expect(snapshot.roads).toEqual([])

    await simulationApp.command({
      type: 'moveWorker',
      payload: {
        runId: 'sim-build-road',
        workerId: 'worker-1',
        target: { x: 2, y: 1 },
      },
    })
    await simulationApp.command({
      type: 'harvestEnergy',
      payload: {
        runId: 'sim-build-road',
        workerId: 'worker-1',
        sourceId: 'source-1',
      },
    })
    await simulationApp.command({
      type: 'harvestEnergy',
      payload: {
        runId: 'sim-build-road',
        workerId: 'worker-1',
        sourceId: 'source-1',
      },
    })
    await simulationApp.command({
      type: 'moveWorker',
      payload: {
        runId: 'sim-build-road',
        workerId: 'worker-1',
        target: { x: 1, y: 0 },
      },
    })

    await simulationApp.command({
      type: 'buildConstructionSite',
      payload: {
        runId: 'sim-build-road',
        workerId: 'worker-1',
        siteId: 'road-site-1',
      },
    })

    snapshot = await simulationApp.query({
      type: 'liveWorldSnapshot',
      payload: {
        runId: 'sim-build-road',
      },
    })
    expect(snapshot.workers[0]).toMatchObject({ energy: 5 })
    expect(snapshot.constructionSites[0]).toMatchObject({
      id: 'road-site-1',
      progress: 5,
    })
    expect(lastRecentEvent(snapshot)).toMatchObject({
      type: 'colonybench-construction-site-built',
      payload: {
        runId: 'sim-build-road',
        workerId: 'worker-1',
        siteId: 'road-site-1',
        amount: 5,
        progress: 5,
        completed: false,
      },
    })

    await simulationApp.command({
      type: 'buildConstructionSite',
      payload: {
        runId: 'sim-build-road',
        workerId: 'worker-1',
        siteId: 'road-site-1',
      },
    })

    snapshot = await simulationApp.query({
      type: 'liveWorldSnapshot',
      payload: {
        runId: 'sim-build-road',
      },
    })
    expect(snapshot.workers[0]).toMatchObject({ energy: 0 })
    expect(snapshot.constructionSites).toEqual([])
    expect(snapshot.roads).toEqual([
      { id: 'road-1', position: { x: 1, y: 0 }, hits: 20, hitsMax: 20 },
    ])
    expect(lastRecentEvent(snapshot)).toMatchObject({
      type: 'colonybench-road-completed',
      payload: {
        runId: 'sim-build-road',
        siteId: 'road-site-1',
        roadId: 'road-1',
        position: { x: 1, y: 0 },
      },
    })
  })

  test('roads decay each tick and adjacent workers can repair them with carried energy', async () => {
    const simulationApp = await createSimulationApp()
    await simulationApp.command({
      type: 'initializeSimulation',
      payload: { runId: 'sim-repair-road' },
    })

    await simulationApp.command({
      type: 'moveWorker',
      payload: {
        runId: 'sim-repair-road',
        workerId: 'worker-1',
        target: { x: 2, y: 1 },
      },
    })
    await simulationApp.command({
      type: 'harvestEnergy',
      payload: {
        runId: 'sim-repair-road',
        workerId: 'worker-1',
        sourceId: 'source-1',
      },
    })
    await simulationApp.command({
      type: 'harvestEnergy',
      payload: {
        runId: 'sim-repair-road',
        workerId: 'worker-1',
        sourceId: 'source-1',
      },
    })
    await simulationApp.command({
      type: 'moveWorker',
      payload: {
        runId: 'sim-repair-road',
        workerId: 'worker-1',
        target: { x: 1, y: 0 },
      },
    })
    await simulationApp.command({
      type: 'buildConstructionSite',
      payload: {
        runId: 'sim-repair-road',
        workerId: 'worker-1',
        siteId: 'road-site-1',
      },
    })
    await simulationApp.command({
      type: 'buildConstructionSite',
      payload: {
        runId: 'sim-repair-road',
        workerId: 'worker-1',
        siteId: 'road-site-1',
      },
    })

    let snapshot = await simulationApp.query({
      type: 'liveWorldSnapshot',
      payload: {
        runId: 'sim-repair-road',
      },
    })
    expect(snapshot.roads).toEqual([
      { id: 'road-1', position: { x: 1, y: 0 }, hits: 20, hitsMax: 20 },
    ])

    await simulationApp.command({
      type: 'advanceTick',
      payload: { runId: 'sim-repair-road' },
    })
    snapshot = await simulationApp.query({
      type: 'liveWorldSnapshot',
      payload: {
        runId: 'sim-repair-road',
      },
    })
    expect(snapshot.roads[0]).toMatchObject({
      id: 'road-1',
      hits: 19,
      hitsMax: 20,
    })
    expect(lastRecentEvent(snapshot)).toMatchObject({
      type: 'colonybench-tick-advanced',
      payload: {
        runId: 'sim-repair-road',
        decayedRoads: [{ roadId: 'road-1', amount: 1, hits: 19 }],
      },
    })

    await simulationApp.command({
      type: 'moveWorker',
      payload: {
        runId: 'sim-repair-road',
        workerId: 'worker-1',
        target: { x: 2, y: 1 },
      },
    })
    await simulationApp.command({
      type: 'harvestEnergy',
      payload: {
        runId: 'sim-repair-road',
        workerId: 'worker-1',
        sourceId: 'source-1',
      },
    })
    await simulationApp.command({
      type: 'moveWorker',
      payload: {
        runId: 'sim-repair-road',
        workerId: 'worker-1',
        target: { x: 1, y: 0 },
      },
    })
    await simulationApp.command({
      type: 'repairRoad',
      payload: {
        runId: 'sim-repair-road',
        workerId: 'worker-1',
        roadId: 'road-1',
      },
    })

    snapshot = await simulationApp.query({
      type: 'liveWorldSnapshot',
      payload: {
        runId: 'sim-repair-road',
      },
    })
    expect(snapshot.roads[0]).toMatchObject({
      id: 'road-1',
      hits: 20,
      hitsMax: 20,
    })
    expect(snapshot.workers[0]).toMatchObject({ energy: 4 })
    expect(lastRecentEvent(snapshot)).toMatchObject({
      type: 'colonybench-road-repaired',
      payload: {
        runId: 'sim-repair-road',
        workerId: 'worker-1',
        roadId: 'road-1',
        amount: 1,
        hits: 20,
      },
    })
  })
})
