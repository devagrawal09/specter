import { describe, expect, test } from 'vitest'

import { baselineBot } from '../bots/baseline'
import {
  createColonyBenchSimulationApp,
  createMemoryColonyBenchSimulationAdapters,
} from '../index'
import { createBotCommandCollector } from './types'
import {
  runColonyBenchLoop,
  streamColonyBenchLoop,
  type ColonyBenchBot,
} from './run-loop'

function createSimulationApp() {
  return createColonyBenchSimulationApp({
    adapters: createMemoryColonyBenchSimulationAdapters(),
  })
}

describe('ColonyBench same-process runner', () => {
  test('command collector records bot commands without mutating the world directly', async () => {
    const simulationApp = await createSimulationApp()
    await simulationApp.initializeSimulation({ runId: 'collector-run' })
    const before = await simulationApp.liveWorldSnapshot({
      runId: 'collector-run',
    })
    const collector = createBotCommandCollector()

    collector.commands.move('worker-1', { x: 2, y: 1 })
    collector.commands.harvest('worker-1', 'source-1')
    collector.commands.deposit('worker-1')
    collector.commands.upgrade('worker-1')
    collector.commands.build('worker-1', 'road-site-1')
    collector.commands.repair('worker-1', 'road-1')
    collector.commands.spawnWorker()

    expect(collector.drain()).toEqual([
      { type: 'move', workerId: 'worker-1', target: { x: 2, y: 1 } },
      { type: 'harvest', workerId: 'worker-1', sourceId: 'source-1' },
      { type: 'deposit', workerId: 'worker-1' },
      { type: 'upgrade', workerId: 'worker-1' },
      { type: 'build', workerId: 'worker-1', siteId: 'road-site-1' },
      { type: 'repair', workerId: 'worker-1', roadId: 'road-1' },
      { type: 'spawnWorker' },
    ])
    await expect(
      simulationApp.liveWorldSnapshot({ runId: 'collector-run' }),
    ).resolves.toEqual(before)
  })

  test('runner calls the baseline bot and advances the requested tick count', async () => {
    const result = await runColonyBenchLoop({
      runId: 'baseline-runner',
      ticks: 4,
      bot: baselineBot,
    })

    expect(result.finalSnapshot.tick).toBe(4)
    expect(result.snapshots).toHaveLength(5)
    expect(result.commandLog).toHaveLength(4)
    expect(result.commandLog.some((entry) => entry.commands.length > 0)).toBe(
      true,
    )
  })

  test('baseline bot improves the world state over enough ticks', async () => {
    const result = await runColonyBenchLoop({
      runId: 'baseline-improves',
      ticks: 45,
      bot: baselineBot,
    })

    expect(result.finalSnapshot.initialized).toBe(true)
    expect(result.finalSnapshot.workers.length).toBeGreaterThanOrEqual(3)
    expect(result.finalSnapshot.base?.level).toBeGreaterThanOrEqual(2)
    expect(
      result.snapshots.some((snapshot) =>
        snapshot.sources.some((source) => source.energy < 100),
      ),
    ).toBe(true)
    expect(
      result.commandLog
        .flatMap((entry) => entry.commands)
        .map((command) => command.type),
    ).toEqual(
      expect.arrayContaining(['spawnWorker', 'deposit', 'upgrade', 'harvest']),
    )
  })

  test('baseline bot builds the initial road construction site during a real run', async () => {
    const result = await runColonyBenchLoop({
      runId: 'baseline-builds-road',
      ticks: 55,
      bot: baselineBot,
    })

    expect(result.finalSnapshot.roads).toEqual([
      expect.objectContaining({
        id: 'road-1',
        position: { x: 1, y: 0 },
        hitsMax: 20,
      }),
    ])
    expect(result.finalSnapshot.constructionSites).toEqual([])
    expect(
      result.commandLog
        .flatMap((entry) => entry.commands)
        .map((command) => command.type),
    ).toContain('build')
  })

  test('baseline bot repairs the road after it decays during a real run', async () => {
    const result = await runColonyBenchLoop({
      runId: 'baseline-repairs-road',
      ticks: 90,
      bot: baselineBot,
    })

    expect(result.finalSnapshot.roads).toEqual([
      expect.objectContaining({ id: 'road-1', hitsMax: 20 }),
    ])
    expect(
      result.commandLog
        .flatMap((entry) => entry.commands)
        .map((command) => command.type),
    ).toContain('repair')
  })

  test('runner passes a Screeps-like Game object that can enqueue commands and update Memory', async () => {
    const memory: { creeps?: Record<string, { saying?: string }> } = {}
    const apiBot: ColonyBenchBot<typeof memory> = {
      loop(ctx) {
        const creep = ctx.game.creeps['worker-1']
        const source = ctx.game.rooms.sim.sources[0]
        if (!creep || !source) throw new Error('expected game creep and source')

        expect(ctx.game.time).toBe(ctx.tick)
        expect(ctx.game.Memory).toBe(memory)
        creep.say('api harvest')
        creep.moveTo(source)
      },
    }

    const result = await runColonyBenchLoop({
      runId: 'api-context-runner',
      ticks: 1,
      bot: apiBot,
      memory,
    })

    expect(result.memory.creeps?.['worker-1']).toMatchObject({
      saying: 'api harvest',
    })
    expect(result.commandLog[0]?.commands).toEqual([
      { type: 'move', workerId: 'worker-1', target: { x: 2, y: 1 } },
    ])
  })

  test('runner frames include Screeps-like API intent return codes for the UI', async () => {
    const apiBot: ColonyBenchBot = {
      loop(ctx) {
        const creep = ctx.game.creeps['worker-1']
        const source = ctx.game.rooms.sim.sources[0]
        if (!creep || !source) throw new Error('expected game creep and source')

        creep.harvest(source)
        creep.moveTo(source)
      },
    }
    const frames = []

    for await (const frame of streamColonyBenchLoop({
      runId: 'api-intent-frame-runner',
      ticks: 1,
      bot: apiBot,
    })) {
      frames.push(frame)
    }

    expect(frames[1]?.apiIntents).toEqual([
      {
        actorId: 'worker-1',
        action: 'harvest',
        targetId: 'source-1',
        code: -9,
      },
      {
        actorId: 'worker-1',
        action: 'moveTo',
        target: { x: 2, y: 1 },
        code: 0,
      },
    ])
  })

  test('runner keeps the same bot memory object across ticks', async () => {
    const memory: { turns: number; seenTicks: number[] } = {
      turns: 0,
      seenTicks: [],
    }
    const bot: ColonyBenchBot<typeof memory> = {
      loop(ctx) {
        ctx.memory.turns += 1
        ctx.memory.seenTicks.push(ctx.tick)
      },
    }

    const result = await runColonyBenchLoop({
      runId: 'memory-runner',
      ticks: 4,
      bot,
      memory,
    })

    expect(result.memory).toBe(memory)
    expect(memory).toEqual({ turns: 4, seenTicks: [0, 1, 2, 3] })
    expect(result.finalSnapshot.tick).toBe(4)
  })

  test('baseline bot publishes per-worker role memory on streamed frames', async () => {
    const frames = []

    for await (const frame of streamColonyBenchLoop({
      runId: 'stream-role-memory',
      ticks: 1,
      bot: baselineBot,
    })) {
      frames.push(frame)
    }

    expect(frames[1]?.memory).toMatchObject({
      creeps: {
        'worker-1': {
          role: 'harvester',
        },
      },
    })
  })

  test('baseline bot role memory includes workers spawned during the yielded frame', async () => {
    const frames = []

    for await (const frame of streamColonyBenchLoop({
      runId: 'stream-spawn-role-memory',
      ticks: 12,
      bot: baselineBot,
    })) {
      frames.push(frame)
    }

    const spawnFrame = frames.find(
      (frame) => frame.snapshot.workers.length >= 2,
    )
    expect(spawnFrame?.snapshot.workers.map((worker) => worker.id)).toContain(
      'worker-2',
    )
    expect(spawnFrame?.memory).toMatchObject({
      creeps: {
        'worker-2': {
          role: 'harvester',
        },
      },
    })
  })

  test('runner stream yields initial and per-tick frames for live UI replay', async () => {
    const frames = []

    for await (const frame of streamColonyBenchLoop({
      runId: 'stream-runner',
      ticks: 2,
      bot: baselineBot,
    })) {
      frames.push(frame)
    }

    expect(frames.map((frame) => frame.tick)).toEqual([0, 1, 2])
    expect(frames[0]).toMatchObject({
      runId: 'stream-runner',
      tick: 0,
      commands: [],
      snapshot: { tick: 0, initialized: true },
    })
    expect(frames[0]?.events.map((event) => event.type)).toEqual([
      'colonybench-simulation-initialized',
    ])
    expect(frames[1]?.commands.length).toBeGreaterThan(0)
    expect(frames[1]?.events.map((event) => event.type)).toContain(
      'colonybench-tick-advanced',
    )
    expect(frames[2]?.snapshot.tick).toBe(2)
  })

  test('runner stream keeps per-frame events after the recent-event window is full', async () => {
    const frames = []

    for await (const frame of streamColonyBenchLoop({
      runId: 'stream-window-rollover',
      ticks: 25,
      bot: baselineBot,
    })) {
      frames.push(frame)
    }

    const lateFrame = frames[frames.length - 1]
    expect(lateFrame?.snapshot.recentEvents).toHaveLength(20)
    expect(lateFrame?.events.map((event) => event.type)).toContain(
      'colonybench-tick-advanced',
    )
    expect(lateFrame?.events.length).toBeLessThan(20)
  })

  test('runner stream preserves both build progress and road completion events from one command', async () => {
    const roadCompletingBot: ColonyBenchBot = {
      loop(ctx) {
        if (ctx.tick !== 0) return
        ctx.commands.move('worker-1', { x: 2, y: 1 })
        ctx.commands.harvest('worker-1', 'source-1')
        ctx.commands.harvest('worker-1', 'source-1')
        ctx.commands.move('worker-1', { x: 1, y: 0 })
        ctx.commands.build('worker-1', 'road-site-1')
        ctx.commands.build('worker-1', 'road-site-1')
      },
    }
    const frames = []

    for await (const frame of streamColonyBenchLoop({
      runId: 'stream-road-completion-events',
      ticks: 1,
      bot: roadCompletingBot,
    })) {
      frames.push(frame)
    }

    const eventTypes = frames[1]?.events.map((event) => event.type) ?? []
    expect(
      eventTypes.filter(
        (type) => type === 'colonybench-construction-site-built',
      ),
    ).toHaveLength(2)
    expect(eventTypes).toEqual(
      expect.arrayContaining([
        'colonybench-construction-site-built',
        'colonybench-road-completed',
        'colonybench-tick-advanced',
      ]),
    )
  })

  test('runner stream preserves every command event when a single tick overflows recent events', async () => {
    const noisyBot: ColonyBenchBot = {
      loop(ctx) {
        if (ctx.tick !== 0) return
        for (let index = 0; index < 25; index += 1) {
          ctx.commands.harvest(`missing-worker-${index}`, 'source-1')
        }
      },
    }
    const frames = []

    for await (const frame of streamColonyBenchLoop({
      runId: 'stream-event-overflow',
      ticks: 1,
      bot: noisyBot,
    })) {
      frames.push(frame)
    }

    const tickFrame = frames[1]
    expect(
      tickFrame?.events.filter(
        (event) => event.type === 'colonybench-command-rejected',
      ),
    ).toHaveLength(25)
    expect(tickFrame?.events.map((event) => event.type)).toContain(
      'colonybench-tick-advanced',
    )
  })

  test('runner stream isolates internal snapshots from bot mutation', async () => {
    const mutatingBot: ColonyBenchBot = {
      loop(ctx) {
        ctx.snapshot.recentEvents.length = 0
        ctx.snapshot.workers[0]!.energy = 999
      },
    }

    const result = await runColonyBenchLoop({
      runId: 'stream-mutation-isolation',
      ticks: 1,
      bot: mutatingBot,
    })

    expect(result.snapshots[0]?.recentEvents).toEqual([
      {
        type: 'colonybench-simulation-initialized',
        payload: { runId: 'stream-mutation-isolation' },
      },
    ])
    expect(result.snapshots[0]?.workers[0]?.energy).toBe(0)
  })
})
