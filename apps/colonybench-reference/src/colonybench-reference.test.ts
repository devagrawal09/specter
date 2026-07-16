import { expect, test } from 'vitest'

import { baselineBot } from './bots/baseline'
import { streamColonyBenchLoop } from './runner/run-loop'

import {
  createColonyBenchControlApp,
  createColonyBenchSimulationApp,
  createMemoryColonyBenchControlAdapters,
  createMemoryColonyBenchSimulationAdapters,
  connectControlRunStartedToSimulation,
} from './index'

test('control app records run creation in detail and list queries', async () => {
  const controlApp = await createColonyBenchControlApp({
    adapters: createMemoryColonyBenchControlAdapters(),
  })

  await controlApp.command({
    type: 'createRun',
    payload: { runId: 'run-1', name: 'Baseline run' },
  })

  await expect(
    controlApp.query({ type: 'runDetail', payload: { runId: 'run-1' } }),
  ).resolves.toEqual({
    runId: 'run-1',
    name: 'Baseline run',
    status: 'created',
  })
  await expect(
    controlApp.query({ type: 'runList', payload: {} }),
  ).resolves.toEqual([
    { runId: 'run-1', name: 'Baseline run', status: 'created' },
  ])
})

test('startRun bridge initializes the separate in-memory simulation app', async () => {
  const simulationApp = await createColonyBenchSimulationApp({
    adapters: createMemoryColonyBenchSimulationAdapters(),
  })
  const controlApp = await createColonyBenchControlApp({
    adapters: createMemoryColonyBenchControlAdapters(),
    bridge: connectControlRunStartedToSimulation(simulationApp),
  })

  await controlApp.command({
    type: 'createRun',
    payload: { runId: 'run-2', name: 'Bridge run' },
  })
  await controlApp.command({ type: 'startRun', payload: { runId: 'run-2' } })

  await expect(
    controlApp.query({ type: 'runDetail', payload: { runId: 'run-2' } }),
  ).resolves.toEqual({
    runId: 'run-2',
    name: 'Bridge run',
    status: 'started',
  })
  await expect(
    simulationApp.query({
      type: 'liveSimulationStatus',
      payload: { runId: 'run-2' },
    }),
  ).resolves.toEqual({
    runId: 'run-2',
    initialized: true,
    status: 'initialized',
  })
})

test('control and simulation apps expose separate command/query surfaces', async () => {
  const controlApp = await createColonyBenchControlApp({
    adapters: createMemoryColonyBenchControlAdapters(),
  })
  const simulationApp = await createColonyBenchSimulationApp({
    adapters: createMemoryColonyBenchSimulationAdapters(),
  })

  expect(Object.keys(controlApp).sort()).toEqual([
    'command',
    'query',
    'subscribe',
  ])
  expect(Object.keys(simulationApp).sort()).toEqual([
    'command',
    'query',
    'subscribe',
  ])
  await expect(
    controlApp.command({
      type: 'initializeSimulation',
      payload: { runId: 'wrong-surface' },
    } as never),
  ).rejects.toMatchObject({ code: 'SPECTER_UNKNOWN_COMMAND' })
  await expect(
    simulationApp.query({ type: 'runList', payload: {} } as never),
  ).rejects.toMatchObject({ code: 'SPECTER_UNKNOWN_QUERY' })
})

test('control app records runner frames for live timeline subscriptions', async () => {
  const controlApp = await createColonyBenchControlApp({
    adapters: createMemoryColonyBenchControlAdapters(),
  })
  await controlApp.command({
    type: 'createRun',
    payload: { runId: 'timeline-run', name: 'Timeline run' },
  })
  await controlApp.command({
    type: 'startRun',
    payload: { runId: 'timeline-run' },
  })

  const timeline = controlApp
    .subscribe({
      type: 'runTimeline',
      payload: {
        runId: 'timeline-run',
      },
    })
    [Symbol.asyncIterator]()
  await expect(timeline.next()).resolves.toEqual({ done: false, value: [] })

  const stream = streamColonyBenchLoop({
    runId: 'timeline-run',
    ticks: 1,
    bot: baselineBot,
  })[Symbol.asyncIterator]()
  const initialFrame = await stream.next()
  expect(initialFrame.done).toBe(false)
  if (initialFrame.done) throw new Error('expected initial runner frame')

  const firstFrame = await controlApp.command({
    type: 'recordRunFrame',
    payload: {
      runId: 'timeline-run',
      tick: initialFrame.value.tick,
      score: initialFrame.value.snapshot.score,
      workerCount: initialFrame.value.snapshot.workers.length,
      baseLevel: initialFrame.value.snapshot.base?.level ?? 0,
      baseEnergy: initialFrame.value.snapshot.base?.energy ?? 0,
      commandCount: initialFrame.value.commands.length,
      eventTypes: initialFrame.value.events.map((event) => event.type),
    },
  })
  await firstFrame.reactions

  await expect(timeline.next()).resolves.toEqual({
    done: false,
    value: [
      {
        runId: 'timeline-run',
        tick: 0,
        score: 0,
        workerCount: 1,
        baseLevel: 1,
        baseEnergy: 0,
        commandCount: 0,
        eventTypes: ['colonybench-simulation-initialized'],
      },
    ],
  })

  const tickFrame = await stream.next()
  expect(tickFrame.done).toBe(false)
  if (tickFrame.done) throw new Error('expected tick runner frame')

  const tickExecution = await controlApp.command({
    type: 'recordRunFrame',
    payload: {
      runId: 'timeline-run',
      tick: tickFrame.value.tick,
      score: tickFrame.value.snapshot.score,
      workerCount: tickFrame.value.snapshot.workers.length,
      baseLevel: tickFrame.value.snapshot.base?.level ?? 0,
      baseEnergy: tickFrame.value.snapshot.base?.energy ?? 0,
      commandCount: tickFrame.value.commands.length,
      eventTypes: tickFrame.value.events.map((event) => event.type),
    },
  })
  await tickExecution.reactions

  const nextTimeline = await timeline.next()
  expect(nextTimeline.done).toBe(false)
  if (nextTimeline.done) throw new Error('expected timeline update')
  expect(nextTimeline.value).toHaveLength(2)
  expect(nextTimeline.value[1]).toMatchObject({
    runId: 'timeline-run',
    tick: 1,
    workerCount: 1,
    commandCount: expect.any(Number),
  })
  expect(nextTimeline.value[1]?.eventTypes).toContain(
    'colonybench-tick-advanced',
  )

  await timeline.return?.()
})

test('control app exposes live run overview summaries for UI polling', async () => {
  const controlApp = await createColonyBenchControlApp({
    adapters: createMemoryColonyBenchControlAdapters(),
  })
  const created = await controlApp.command({
    type: 'createRun',
    payload: { runId: 'overview-run', name: 'Overview run' },
  })
  await created.reactions
  const started = await controlApp.command({
    type: 'startRun',
    payload: { runId: 'overview-run' },
  })
  await started.reactions

  const overview = controlApp
    .subscribe({
      type: 'runOverview',
      payload: {
        runId: 'overview-run',
      },
    })
    [Symbol.asyncIterator]()

  await expect(overview.next()).resolves.toEqual({
    done: false,
    value: {
      run: { runId: 'overview-run', name: 'Overview run', status: 'started' },
      frameCount: 0,
      latestFrame: null,
    },
  })

  const firstFrame = await controlApp.command({
    type: 'recordRunFrame',
    payload: {
      runId: 'overview-run',
      tick: 0,
      score: 0,
      workerCount: 1,
      baseLevel: 1,
      baseEnergy: 0,
      commandCount: 0,
      eventTypes: ['colonybench-simulation-initialized'],
    },
  })
  await firstFrame.reactions
  const secondFrame = await controlApp.command({
    type: 'recordRunFrame',
    payload: {
      runId: 'overview-run',
      tick: 1,
      score: 100,
      workerCount: 2,
      baseLevel: 2,
      baseEnergy: 5,
      commandCount: 3,
      eventTypes: ['colonybench-tick-advanced'],
    },
  })
  await secondFrame.reactions

  await expect(overview.next()).resolves.toEqual({
    done: false,
    value: {
      run: { runId: 'overview-run', name: 'Overview run', status: 'started' },
      frameCount: 2,
      latestFrame: {
        runId: 'overview-run',
        tick: 1,
        score: 100,
        workerCount: 2,
        baseLevel: 2,
        baseEnergy: 5,
        commandCount: 3,
        eventTypes: ['colonybench-tick-advanced'],
      },
    },
  })

  const firstQuery = await controlApp.query({
    type: 'runOverview',
    payload: { runId: 'overview-run' },
  })
  firstQuery.latestFrame?.eventTypes.push('mutated')

  await expect(
    controlApp.query({
      type: 'runOverview',
      payload: { runId: 'overview-run' },
    }),
  ).resolves.toEqual({
    run: { runId: 'overview-run', name: 'Overview run', status: 'started' },
    frameCount: 2,
    latestFrame: {
      runId: 'overview-run',
      tick: 1,
      score: 100,
      workerCount: 2,
      baseLevel: 2,
      baseEnergy: 5,
      commandCount: 3,
      eventTypes: ['colonybench-tick-advanced'],
    },
  })

  await overview.return?.()
})

test('control app publishes completed run status for live UI overviews', async () => {
  const controlApp = await createColonyBenchControlApp({
    adapters: createMemoryColonyBenchControlAdapters(),
  })
  await controlApp.command({
    type: 'createRun',
    payload: { runId: 'completed-run', name: 'Completed run' },
  })
  await controlApp.command({
    type: 'startRun',
    payload: { runId: 'completed-run' },
  })

  const overview = controlApp
    .subscribe({
      type: 'runOverview',
      payload: {
        runId: 'completed-run',
      },
    })
    [Symbol.asyncIterator]()
  await expect(overview.next()).resolves.toEqual({
    done: false,
    value: {
      run: { runId: 'completed-run', name: 'Completed run', status: 'started' },
      frameCount: 0,
      latestFrame: null,
    },
  })

  const recordedFrame = await controlApp.command({
    type: 'recordRunFrame',
    payload: {
      runId: 'completed-run',
      tick: 3,
      score: 100,
      workerCount: 2,
      baseLevel: 2,
      baseEnergy: 0,
      commandCount: 1,
      eventTypes: ['colonybench-tick-advanced'],
    },
  })
  await recordedFrame.reactions
  const completed = await controlApp.command({
    type: 'completeRun',
    payload: { runId: 'completed-run' },
  })
  await completed.reactions

  await expect(overview.next()).resolves.toEqual({
    done: false,
    value: {
      run: {
        runId: 'completed-run',
        name: 'Completed run',
        status: 'completed',
      },
      frameCount: 1,
      latestFrame: {
        runId: 'completed-run',
        tick: 3,
        score: 100,
        workerCount: 2,
        baseLevel: 2,
        baseEnergy: 0,
        commandCount: 1,
        eventTypes: ['colonybench-tick-advanced'],
      },
    },
  })
  await overview.return?.()
})

test('control app rejects restarting completed runs', async () => {
  const controlApp = await createColonyBenchControlApp({
    adapters: createMemoryColonyBenchControlAdapters(),
  })

  await controlApp.command({
    type: 'createRun',
    payload: {
      runId: 'restart-completed-run',
      name: 'Restart guard',
    },
  })
  await controlApp.command({
    type: 'startRun',
    payload: { runId: 'restart-completed-run' },
  })
  await controlApp.command({
    type: 'completeRun',
    payload: { runId: 'restart-completed-run' },
  })

  await expect(
    controlApp.command({
      type: 'startRun',
      payload: { runId: 'restart-completed-run' },
    }),
  ).rejects.toThrow('Run already completed: restart-completed-run')
  await expect(
    controlApp.query({
      type: 'runDetail',
      payload: { runId: 'restart-completed-run' },
    }),
  ).resolves.toEqual({
    runId: 'restart-completed-run',
    name: 'Restart guard',
    status: 'completed',
  })
})

test('control app rejects completing runs before they start', async () => {
  const controlApp = await createColonyBenchControlApp({
    adapters: createMemoryColonyBenchControlAdapters(),
  })

  await controlApp.command({
    type: 'createRun',
    payload: {
      runId: 'unstarted-complete-run',
      name: 'Complete guard',
    },
  })

  await expect(
    controlApp.command({
      type: 'completeRun',
      payload: { runId: 'unstarted-complete-run' },
    }),
  ).rejects.toThrow('Run not started: unstarted-complete-run')
  await expect(
    controlApp.query({
      type: 'runDetail',
      payload: { runId: 'unstarted-complete-run' },
    }),
  ).resolves.toEqual({
    runId: 'unstarted-complete-run',
    name: 'Complete guard',
    status: 'created',
  })
})

test('simulation app supports liveSimulationStatus subscriptions', async () => {
  const simulationApp = await createColonyBenchSimulationApp({
    adapters: createMemoryColonyBenchSimulationAdapters(),
  })
  const subscription = simulationApp
    .subscribe({
      type: 'liveSimulationStatus',
      payload: {
        runId: 'run-3',
      },
    })
    [Symbol.asyncIterator]()

  await expect(subscription.next()).resolves.toEqual({
    done: false,
    value: { runId: 'run-3', initialized: false, status: 'missing' },
  })

  await simulationApp.command({
    type: 'initializeSimulation',
    payload: { runId: 'run-3' },
  })

  await expect(subscription.next()).resolves.toEqual({
    done: false,
    value: { runId: 'run-3', initialized: true, status: 'initialized' },
  })
  await subscription.return?.()
})
