import { describe, expect, test } from 'vitest'

import { createBotCommandCollector } from '../runner/types'
import type { ColonyBenchWorldSnapshot } from '../simulation/state'
import {
  ERR_NOT_ENOUGH_ENERGY,
  ERR_NOT_IN_RANGE,
  ERR_INVALID_TARGET,
  FIND_CONSTRUCTION_SITES,
  FIND_SOURCES,
  FIND_STRUCTURES,
  OK,
  RESOURCE_ENERGY,
  createColonyBenchGame,
  type ColonyBenchApiIntentLogEntry,
} from './game'

function snapshot(
  overrides: Partial<ColonyBenchWorldSnapshot> = {},
): ColonyBenchWorldSnapshot {
  return {
    runId: 'api-run',
    initialized: true,
    tick: 7,
    score: 0,
    base: {
      id: 'base-1',
      position: { x: 0, y: 0 },
      energy: 0,
      level: 1,
      upgradeProgress: 0,
    },
    controller: {
      id: 'controller-1',
      position: { x: 0, y: -1 },
      level: 1,
      progress: 0,
      progressTotal: 10,
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
    constructionSites: [
      {
        id: 'road-site-1',
        structureType: 'road',
        position: { x: 1, y: 0 },
        progress: 0,
        progressTotal: 10,
      },
    ],
    roads: [],
    terrain: [{ id: 'wall-1', position: { x: -1, y: 1 }, terrain: 'wall' }],
    recentEvents: [],
    ...overrides,
  }
}

describe('ColonyBench Screeps-like bot API', () => {
  test('exposes Game.time, Memory, creeps, spawns, room sources, and construction sites', () => {
    const memory = { creeps: { 'worker-1': { role: 'harvester' } } }
    const collector = createBotCommandCollector()

    const game = createColonyBenchGame({
      snapshot: snapshot(),
      commands: collector.commands,
      memory,
    })

    expect(game.time).toBe(7)
    expect(game.Memory).toBe(memory)
    expect(game.creeps['worker-1']).toMatchObject({
      id: 'worker-1',
      name: 'worker-1',
      memory: { role: 'harvester' },
      store: { energy: 0, capacity: 10 },
      pos: { x: 0, y: 1 },
    })
    expect(game.spawns['base-1']).toMatchObject({
      id: 'base-1',
      name: 'base-1',
      store: { energy: 0 },
      pos: { x: 0, y: 0 },
    })
    expect(game.rooms.sim.sources.map((source) => source.id)).toEqual([
      'source-1',
      'source-2',
    ])
    expect(
      game.rooms.sim.find(FIND_SOURCES).map((source) => source.id),
    ).toEqual(['source-1', 'source-2'])
    expect(
      game.rooms.sim.find(FIND_CONSTRUCTION_SITES).map((site) => site.id),
    ).toEqual(['road-site-1'])
    expect(game.rooms.sim.getTerrainAt(-1, 1)).toBe('wall')
    expect(game.rooms.sim.getTerrainAt(0, 0)).toBe('plain')
  })

  test('creep actions return Screeps-like codes, enqueue commands, and expose API intent logs', () => {
    const collector = createBotCommandCollector()
    const apiIntents: ColonyBenchApiIntentLogEntry[] = []
    const game = createColonyBenchGame({
      snapshot: snapshot(),
      commands: collector.commands,
      memory: {},
      apiIntents,
    })
    const creep = game.creeps['worker-1']
    const source = game.rooms.sim.sources[0]

    expect(creep?.harvest(source)).toBe(ERR_NOT_IN_RANGE)
    expect(collector.peek()).toEqual([])

    expect(creep?.moveTo(source)).toBe(OK)
    expect(collector.drain()).toEqual([
      { type: 'move', workerId: 'worker-1', target: { x: 2, y: 1 } },
    ])
    expect(apiIntents).toEqual([
      {
        actorId: 'worker-1',
        action: 'harvest',
        targetId: 'source-1',
        code: ERR_NOT_IN_RANGE,
      },
      {
        actorId: 'worker-1',
        action: 'moveTo',
        target: { x: 2, y: 1 },
        code: OK,
      },
    ])

    const adjacentCollector = createBotCommandCollector()
    const adjacentGame = createColonyBenchGame({
      snapshot: snapshot({
        workers: [
          {
            id: 'worker-1',
            position: { x: 1, y: 1 },
            energy: 0,
            capacity: 10,
          },
        ],
      }),
      commands: adjacentCollector.commands,
      memory: {},
    })
    expect(
      adjacentGame.creeps['worker-1']?.harvest(
        adjacentGame.rooms.sim.sources[0],
      ),
    ).toBe(OK)
    expect(adjacentCollector.drain()).toEqual([
      { type: 'harvest', workerId: 'worker-1', sourceId: 'source-1' },
    ])
  })

  test('spawn and worker resource actions map to existing ColonyBench commands', () => {
    const collector = createBotCommandCollector()
    const game = createColonyBenchGame({
      snapshot: snapshot({
        base: {
          id: 'base-1',
          position: { x: 0, y: 0 },
          energy: 10,
          level: 1,
          upgradeProgress: 0,
        },
        workers: [
          {
            id: 'worker-1',
            position: { x: 0, y: 0 },
            energy: 5,
            capacity: 10,
          },
        ],
      }),
      commands: collector.commands,
      memory: {},
    })

    const creep = game.creeps['worker-1']
    const spawn = game.spawns['base-1']
    const site = game.rooms.sim.constructionSites[0]

    expect(spawn?.spawnCreep(['work', 'carry', 'move'], 'worker-next')).toBe(OK)
    expect(creep?.transfer(spawn, RESOURCE_ENERGY)).toBe(OK)
    expect(creep?.upgradeController()).toBe(OK)
    expect(creep?.build(site)).toBe(OK)
    expect(collector.drain()).toEqual([
      { type: 'spawnWorker' },
      { type: 'deposit', workerId: 'worker-1' },
      { type: 'upgrade', workerId: 'worker-1' },
      { type: 'build', workerId: 'worker-1', siteId: 'road-site-1' },
    ])
  })

  test('creep.say publishes Screeps-like worker speech into Memory without an action command', () => {
    const memory = { creeps: { 'worker-1': { role: 'harvester' } } }
    const collector = createBotCommandCollector()
    const game = createColonyBenchGame({
      snapshot: snapshot(),
      commands: collector.commands,
      memory,
    })

    expect(game.creeps['worker-1']?.say('harvesting source-1')).toBe(OK)
    expect(memory.creeps['worker-1']).toMatchObject({
      role: 'harvester',
      saying: 'harvesting source-1',
    })
    expect(collector.peek()).toEqual([])
  })

  test('controller API is separate from the spawn and gates upgrade range', () => {
    const collector = createBotCommandCollector()
    const game = createColonyBenchGame({
      snapshot: snapshot({
        controller: {
          id: 'controller-1',
          position: { x: 0, y: -1 },
          level: 1,
          progress: 0,
          progressTotal: 10,
        },
        workers: [
          {
            id: 'worker-1',
            position: { x: 0, y: 1 },
            energy: 5,
            capacity: 10,
          },
        ],
      }),
      commands: collector.commands,
      memory: {},
    })

    expect(game.rooms.sim.controller).toMatchObject({
      id: 'controller-1',
      pos: { x: 0, y: -1 },
      level: 1,
      progress: 0,
      progressTotal: 10,
    })
    expect(
      game.creeps['worker-1']?.upgradeController(game.rooms.sim.controller),
    ).toBe(ERR_NOT_IN_RANGE)
    expect(collector.peek()).toEqual([])
  })

  test('spawnCreep rejects when the base lacks worker energy', () => {
    const collector = createBotCommandCollector()
    const game = createColonyBenchGame({
      snapshot: snapshot(),
      commands: collector.commands,
      memory: {},
    })

    expect(game.spawns['base-1']?.spawnCreep(['work'], 'worker-next')).toBe(
      ERR_NOT_ENOUGH_ENERGY,
    )
    expect(collector.peek()).toEqual([])
  })

  test('creep actions reject forged API targets before enqueueing commands', () => {
    const collector = createBotCommandCollector()
    const apiIntents: ColonyBenchApiIntentLogEntry[] = []
    const game = createColonyBenchGame({
      snapshot: snapshot({
        workers: [
          {
            id: 'worker-1',
            position: { x: 0, y: 1 },
            energy: 5,
            capacity: 10,
          },
        ],
      }),
      commands: collector.commands,
      memory: {},
      apiIntents,
    })
    const forgedSource = {
      id: 'forged-source',
      pos: { x: 0, y: 1 },
      energy: 100,
    }

    expect(game.creeps['worker-1']?.harvest(forgedSource)).toBe(
      ERR_INVALID_TARGET,
    )
    expect(collector.peek()).toEqual([])
    expect(apiIntents).toEqual([
      {
        actorId: 'worker-1',
        action: 'harvest',
        targetId: 'forged-source',
        code: ERR_INVALID_TARGET,
      },
    ])
  })

  test('road structures are findable and repairable through the Screeps-like API', () => {
    const collector = createBotCommandCollector()
    const game = createColonyBenchGame({
      snapshot: snapshot({
        workers: [
          {
            id: 'worker-1',
            position: { x: 1, y: 0 },
            energy: 5,
            capacity: 10,
          },
        ],
        roads: [
          { id: 'road-1', position: { x: 1, y: 0 }, hits: 12, hitsMax: 20 },
        ],
      }),
      commands: collector.commands,
      memory: {},
    })

    expect(game.rooms.sim.find(FIND_STRUCTURES)).toEqual(game.rooms.sim.roads)
    const road = game.rooms.sim.roads[0]
    expect(road).toMatchObject({
      id: 'road-1',
      structureType: 'road',
      pos: { x: 1, y: 0 },
      hits: 12,
      hitsMax: 20,
    })
    expect(game.creeps['worker-1']?.repair(road)).toBe(OK)
    expect(collector.drain()).toEqual([
      { type: 'repair', workerId: 'worker-1', roadId: 'road-1' },
    ])
  })

  test('room.lookAt returns Screeps-like object stack for bots inspecting a cell', () => {
    const collector = createBotCommandCollector()
    const game = createColonyBenchGame({
      snapshot: snapshot({
        workers: [
          {
            id: 'worker-1',
            position: { x: 0, y: 0 },
            energy: 5,
            capacity: 10,
          },
        ],
        roads: [
          { id: 'road-1', position: { x: 0, y: 0 }, hits: 12, hitsMax: 20 },
        ],
      }),
      commands: collector.commands,
      memory: {},
    })

    expect(game.rooms.sim.lookAt(0, 0)).toEqual([
      { type: 'structure', structure: game.spawns['base-1'] },
      { type: 'structure', structure: game.rooms.sim.roads[0] },
      { type: 'creep', creep: game.creeps['worker-1'] },
    ])
    expect(game.rooms.sim.lookAt(-1, 1)).toEqual([
      { type: 'terrain', terrain: 'wall' },
    ])
  })
})
