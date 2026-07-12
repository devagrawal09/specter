import { describe, expect, test } from 'vitest'

import type {
  ColonyBenchRunFrameSummary,
  ColonyBenchRunOverview,
} from '../control/state'
import type { ColonyBenchRunFrame } from '../runner/run-loop'
import { buildColonyBenchGameModel, buildColonyBenchViewModel } from './model'

describe('ColonyBench UI model', () => {
  test('builds hero metrics and recent frame rows from a recorded run', () => {
    const latestFrame: ColonyBenchRunFrameSummary = {
      runId: 'baseline-ui',
      tick: 30,
      score: 42,
      workerCount: 3,
      baseLevel: 2,
      baseEnergy: 7,
      commandCount: 2,
      eventTypes: ['colonybenchEnergyDeposited', 'colonybenchTickAdvanced'],
    }
    const overview: ColonyBenchRunOverview = {
      run: {
        runId: 'baseline-ui',
        name: 'Baseline UI',
        status: 'completed',
      },
      frameCount: 3,
      latestFrame,
    }

    const model = buildColonyBenchViewModel({
      overview,
      timeline: [
        {
          runId: 'baseline-ui',
          tick: 28,
          score: 20,
          workerCount: 2,
          baseLevel: 1,
          baseEnergy: 4,
          commandCount: 1,
          eventTypes: ['colonybenchWorkerMoved'],
        },
        {
          runId: 'baseline-ui',
          tick: 29,
          score: 30,
          workerCount: 2,
          baseLevel: 1,
          baseEnergy: 9,
          commandCount: 1,
          eventTypes: ['colonybenchEnergyHarvested'],
        },
        latestFrame,
      ],
    })

    expect(model.title).toBe('ColonyBench')
    expect(model.status).toBe('completed')
    expect(model.metrics).toEqual([
      { label: 'Tick', value: '30' },
      { label: 'Score', value: '42' },
      { label: 'Workers', value: '3' },
      { label: 'Base level', value: '2' },
      { label: 'Base energy', value: '7' },
    ])
    expect(model.recentFrames.map((frame) => frame.tick)).toEqual([30, 29, 28])
    expect(model.recentFrames[0]?.eventTypes).toEqual([
      'colonybenchEnergyDeposited',
      'colonybenchTickAdvanced',
    ])
  })

  test('adapts a live runner frame into bounded board cells and activity labels', () => {
    const frame: ColonyBenchRunFrame = {
      runId: 'baseline-ui',
      tick: 3,
      snapshot: {
        runId: 'baseline-ui',
        initialized: true,
        tick: 3,
        score: 100,
        base: {
          id: 'base-1',
          position: { x: 0, y: 0 },
          energy: 12,
          level: 2,
          upgradeProgress: 4,
        },
        controller: {
          id: 'controller-1',
          position: { x: 0, y: -1 },
          level: 2,
          progress: 4,
          progressTotal: 10,
        },
        workers: [
          {
            id: 'worker-1',
            position: { x: 0, y: 0 },
            energy: 5,
            capacity: 10,
          },
          {
            id: 'worker-2',
            position: { x: 2, y: 1 },
            energy: 0,
            capacity: 10,
          },
        ],
        sources: [
          { id: 'source-1', position: { x: 2, y: 1 }, energy: 95 },
          { id: 'source-2', position: { x: -2, y: 0 }, energy: 80 },
        ],
        constructionSites: [
          {
            id: 'road-site-1',
            structureType: 'road',
            position: { x: 1, y: 0 },
            progress: 5,
            progressTotal: 10,
          },
        ],
        roads: [
          { id: 'road-1', position: { x: -1, y: 0 }, hits: 12, hitsMax: 20 },
        ],
        terrain: [{ id: 'wall-1', position: { x: -1, y: 1 }, terrain: 'wall' }],
        recentEvents: [
          { type: 'colonybenchWorkerMoved', payload: { workerId: 'worker-2' } },
        ],
      },
      commands: [
        { type: 'move', workerId: 'worker-2', target: { x: 2, y: 1 } },
        { type: 'deposit', workerId: 'worker-1' },
      ],
      apiIntents: [
        {
          actorId: 'worker-2',
          action: 'harvest',
          targetId: 'source-1',
          code: -9,
        },
        {
          actorId: 'worker-2',
          action: 'moveTo',
          target: { x: 2, y: 1 },
          code: 0,
        },
      ],
      memory: {
        creeps: {
          'worker-1': { role: 'upgrader', saying: 'upgrading controller' },
          'worker-2': { role: 'harvester', saying: 'moving to source' },
        },
      },
      events: [
        {
          type: 'colonybenchEnergyDeposited',
          payload: { workerId: 'worker-1' },
        },
      ],
    }

    const model = buildColonyBenchGameModel({
      frame,
      status: 'running',
      frameCount: 4,
    })

    expect(model.status).toBe('running')
    expect(model.bounds).toEqual({ minX: -3, maxX: 3, minY: -2, maxY: 2 })
    expect(model.cells).toHaveLength(35)
    expect(
      model.cells.find((cell) => cell.x === 0 && cell.y === 0)?.entities,
    ).toEqual([
      {
        kind: 'base',
        id: 'base-1',
        label: 'Base L2',
        detail: '12 energy',
        meter: {
          kind: 'progress',
          label: 'Base upgrade 4/10',
          value: 4,
          max: 10,
        },
      },
      {
        kind: 'worker',
        id: 'worker-1',
        label: 'worker-1',
        detail: 'upgrader · 5/10 · says “upgrading controller”',
        meter: {
          kind: 'energy',
          label: 'worker-1 energy 5/10',
          value: 5,
          max: 10,
        },
      },
    ])
    expect(
      model.cells.find((cell) => cell.x === 2 && cell.y === 1)?.entities,
    ).toEqual([
      {
        kind: 'source',
        id: 'source-1',
        label: 'source-1',
        detail: '95 energy',
        meter: {
          kind: 'energy',
          label: 'source-1 energy 95/100',
          value: 95,
          max: 100,
        },
      },
      {
        kind: 'intent',
        id: 'move-target-worker-2',
        label: 'move target',
        detail: 'worker-2 is moving here',
        relatedEntityId: 'worker-2',
      },
      {
        kind: 'worker',
        id: 'worker-2',
        label: 'worker-2',
        detail: 'harvester · 0/10 · says “moving to source”',
        meter: {
          kind: 'energy',
          label: 'worker-2 energy 0/10',
          value: 0,
          max: 10,
        },
      },
    ])
    expect(
      model.cells.find((cell) => cell.x === 1 && cell.y === 0)?.entities,
    ).toEqual([
      {
        kind: 'constructionSite',
        id: 'road-site-1',
        label: 'road site',
        detail: '5/10 built',
        meter: {
          kind: 'progress',
          label: 'road site progress 5/10',
          value: 5,
          max: 10,
        },
      },
    ])
    expect(
      model.cells.find((cell) => cell.x === -1 && cell.y === 0)?.entities,
    ).toEqual([
      {
        kind: 'road',
        id: 'road-1',
        label: 'road',
        detail: '12/20 hits · road surface',
        meter: {
          kind: 'durability',
          label: 'road durability 12/20',
          value: 12,
          max: 20,
        },
      },
    ])
    expect(
      model.cells.find((cell) => cell.x === -1 && cell.y === 1)?.entities,
    ).toEqual([
      {
        kind: 'terrain',
        id: 'wall-1',
        label: 'wall',
        detail: 'impassable terrain',
      },
    ])
    expect(model.metrics).toEqual([
      { label: 'Tick', value: '3' },
      { label: 'Score', value: '100' },
      { label: 'Base level', value: '2' },
      { label: 'Base energy', value: '12' },
      { label: 'Workers', value: '2' },
      { label: 'Sites', value: '1' },
      { label: 'Roads', value: '1' },
      { label: 'Damaged roads', value: '1' },
    ])
    expect(model.recentCommands).toEqual([
      'worker-2 move to 2,1',
      'worker-1 deposit',
    ])
    expect(model.recentApiIntents).toEqual([
      'worker-2 harvest source-1 → ERR_NOT_IN_RANGE',
      'worker-2 moveTo 2,1 → OK',
    ])
    expect(model.recentEvents).toEqual([
      'Energy Deposited: worker-1 deposited energy',
    ])
    expect(model.baseDetails).toEqual([
      'Level 2 base at 0,0',
      '12 stored energy',
      '4/10 upgrade progress',
    ])
    expect(model.workerDetails).toEqual([
      {
        id: 'worker-1',
        detail:
          'Role upgrader · Says “upgrading controller” · At base carrying 5/10 energy',
        activity: 'Depositing energy',
      },
      {
        id: 'worker-2',
        detail:
          'Role harvester · Says “moving to source” · At 2,1 carrying 0/10 energy',
        activity: 'Moving to 2,1',
      },
    ])
    expect(model.sourceDetails).toEqual([
      {
        id: 'source-1',
        detail: '95 energy at 2,1',
        activity: 'worker-2 nearby',
      },
      { id: 'source-2', detail: '80 energy at -2,0', activity: 'Untapped' },
    ])
    expect(model.constructionDetails).toEqual([
      {
        id: 'road-site-1',
        detail: 'road at 1,0 · 5/10 built',
        activity: 'Buildable',
      },
    ])
    expect(model.activityHistory).toEqual([
      'Energy Deposited: worker-1 deposited energy',
      'Move: worker-2 to 2,1',
      'Deposit: worker-1',
    ])
  })

  test('builds an inspector summary for the selected board cell', () => {
    const frame: ColonyBenchRunFrame = {
      runId: 'selected-cell-ui',
      tick: 9,
      snapshot: {
        runId: 'selected-cell-ui',
        initialized: true,
        tick: 9,
        score: 100,
        base: {
          id: 'base-1',
          position: { x: 0, y: 0 },
          energy: 12,
          level: 2,
          upgradeProgress: 4,
        },
        controller: {
          id: 'controller-1',
          position: { x: 0, y: -1 },
          level: 2,
          progress: 4,
          progressTotal: 10,
        },
        workers: [
          {
            id: 'worker-1',
            position: { x: 0, y: 0 },
            energy: 5,
            capacity: 10,
          },
        ],
        sources: [{ id: 'source-1', position: { x: 2, y: 1 }, energy: 95 }],
        constructionSites: [],
        roads: [],
        terrain: [],
        recentEvents: [],
      },
      commands: [{ type: 'upgrade', workerId: 'worker-1' }],
      memory: {
        creeps: {
          'worker-1': { role: 'upgrader' },
        },
      },
      events: [],
    }

    const model = buildColonyBenchGameModel({
      frame,
      status: 'running',
      frameCount: 10,
      selectedCell: { x: 0, y: 0 },
    })

    expect(model.selectedCellDetails).toEqual({
      title: 'Cell 0,0',
      details: [
        'API lookAt stack: structure base-1, creep worker-1',
        'Base base-1: level 2 · 12 energy · upgrade 4/10',
        'Worker worker-1: upgrader · carrying 5/10 · Upgrading base',
      ],
    })
  })

  test('renders the separate controller on the board and selected-cell inspector', () => {
    const frame: ColonyBenchRunFrame = {
      runId: 'controller-ui',
      tick: 5,
      snapshot: {
        runId: 'controller-ui',
        initialized: true,
        tick: 5,
        score: 0,
        base: {
          id: 'base-1',
          position: { x: 0, y: 0 },
          energy: 3,
          level: 1,
          upgradeProgress: 4,
        },
        controller: {
          id: 'controller-1',
          position: { x: 0, y: -1 },
          level: 1,
          progress: 4,
          progressTotal: 10,
        },
        workers: [],
        sources: [],
        constructionSites: [],
        roads: [],
        terrain: [],
        recentEvents: [],
      },
      commands: [],
      memory: {},
      events: [],
    }

    const model = buildColonyBenchGameModel({
      frame,
      status: 'running',
      frameCount: 6,
      selectedCell: { x: 0, y: -1 },
    })

    expect(
      model.cells.find((cell) => cell.x === 0 && cell.y === -1)?.entities,
    ).toEqual([
      {
        kind: 'controller',
        id: 'controller-1',
        label: 'Controller L1',
        detail: '4/10 upgrade',
        meter: {
          kind: 'progress',
          label: 'Controller upgrade 4/10',
          value: 4,
          max: 10,
        },
      },
    ])
    expect(model.selectedCellDetails).toEqual({
      title: 'Cell 0,-1',
      details: [
        'API lookAt stack: structure controller-1',
        'Controller controller-1: level 1 · upgrade 4/10',
      ],
    })
  })
})
