import {
  createColonyBenchGame,
  type ColonyBenchApiIntentLogEntry,
  type ColonyBenchApiMemory,
} from '../api/game'
import {
  createColonyBenchSimulationApp,
  createMemoryColonyBenchSimulationAdapters,
  type ColonyBenchSimulationApp,
} from '../index'
import type {
  ColonyBenchWorldEventSummary,
  ColonyBenchWorldSnapshot,
} from '../simulation/state'
import {
  createBotCommandCollector,
  type ColonyBenchBot,
  type ColonyBenchBotCommand,
  type ColonyBenchBotMemory,
} from './types'

export type { ColonyBenchBot, ColonyBenchBotContext } from './types'

export type ColonyBenchRunCommandLogEntry = {
  tick: number
  commands: ColonyBenchBotCommand[]
}

export type RunColonyBenchLoopOptions<
  TMemory extends object = ColonyBenchBotMemory,
> = {
  runId: string
  ticks: number
  bot: ColonyBenchBot<TMemory>
  simulationApp?: ColonyBenchSimulationApp
  memory?: TMemory
}

export type RunColonyBenchLoopResult<
  TMemory extends object = ColonyBenchBotMemory,
> = {
  runId: string
  ticks: number
  memory: TMemory
  snapshots: ColonyBenchWorldSnapshot[]
  commandLog: ColonyBenchRunCommandLogEntry[]
  finalSnapshot: ColonyBenchWorldSnapshot
}

export type ColonyBenchRunFrame<TMemory extends object = object> = {
  runId: string
  tick: number
  snapshot: ColonyBenchWorldSnapshot
  commands: ColonyBenchBotCommand[]
  apiIntents?: ColonyBenchApiIntentLogEntry[]
  events: ColonyBenchWorldEventSummary[]
  memory: TMemory
}

function createDefaultSimulationApp() {
  return createColonyBenchSimulationApp({
    adapters: createMemoryColonyBenchSimulationAdapters(),
  })
}

async function applyBotCommand({
  app,
  runId,
  command,
}: {
  app: ColonyBenchSimulationApp
  runId: string
  command: ColonyBenchBotCommand
}) {
  switch (command.type) {
    case 'move':
      await app.moveWorker({
        runId,
        workerId: command.workerId,
        target: command.target,
      })
      return
    case 'harvest':
      await app.harvestEnergy({
        runId,
        workerId: command.workerId,
        sourceId: command.sourceId,
      })
      return
    case 'deposit':
      await app.depositEnergy({ runId, workerId: command.workerId })
      return
    case 'upgrade':
      await app.upgradeBase({ runId, workerId: command.workerId })
      return
    case 'build':
      await app.buildConstructionSite({
        runId,
        workerId: command.workerId,
        siteId: command.siteId,
      })
      return
    case 'repair':
      await app.repairRoad({
        runId,
        workerId: command.workerId,
        roadId: command.roadId,
      })
      return
    case 'spawnWorker': {
      const snapshot = await app.liveWorldSnapshot({ runId })
      await app.spawnWorker({
        runId,
        workerId: `worker-${snapshot.workers.length + 1}`,
      })
      return
    }
  }
}

function assertValidTickCount(ticks: number) {
  if (!Number.isInteger(ticks) || ticks < 0) {
    throw new Error('ticks must be a non-negative integer')
  }
}

function cloneRunnerValue<TValue>(value: TValue): TValue {
  return JSON.parse(JSON.stringify(value)) as TValue
}

function sameRunnerValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function appendedEventsBetween(
  before: ColonyBenchWorldSnapshot,
  after: ColonyBenchWorldSnapshot,
): ColonyBenchWorldEventSummary[] {
  const beforeEvents = before.recentEvents
  const afterEvents = after.recentEvents
  let overlap = Math.min(beforeEvents.length, afterEvents.length)

  while (overlap > 0) {
    const beforeSuffix = beforeEvents.slice(beforeEvents.length - overlap)
    const afterPrefix = afterEvents.slice(0, overlap)
    if (sameRunnerValue(beforeSuffix, afterPrefix)) break
    overlap -= 1
  }

  return afterEvents.slice(overlap).map(cloneRunnerValue)
}

function latestEventFromSnapshot(
  snapshot: ColonyBenchWorldSnapshot,
): ColonyBenchWorldEventSummary {
  const event = snapshot.recentEvents[snapshot.recentEvents.length - 1]
  if (!event) throw new Error('runner expected a simulation event')

  return cloneRunnerValue(event)
}

export async function* streamColonyBenchLoop<
  TMemory extends object = ColonyBenchBotMemory,
>({
  runId,
  ticks,
  bot,
  simulationApp,
  memory = {} as TMemory,
}: RunColonyBenchLoopOptions<TMemory>): AsyncGenerator<
  ColonyBenchRunFrame<TMemory>,
  RunColonyBenchLoopResult<TMemory>
> {
  assertValidTickCount(ticks)
  const app = simulationApp ?? (await createDefaultSimulationApp())

  await app.initializeSimulation({ runId })

  const initialSnapshot = await app.liveWorldSnapshot({ runId })
  const snapshots: ColonyBenchWorldSnapshot[] = [
    cloneRunnerValue(initialSnapshot),
  ]
  const commandLog: ColonyBenchRunCommandLogEntry[] = []
  yield {
    runId,
    tick: initialSnapshot.tick,
    snapshot: cloneRunnerValue(initialSnapshot),
    commands: [],
    apiIntents: [],
    events: cloneRunnerValue(initialSnapshot.recentEvents),
    memory: cloneRunnerValue(memory),
  }

  for (let step = 0; step < ticks; step += 1) {
    const snapshot = snapshots[snapshots.length - 1]
    if (!snapshot) throw new Error('runner snapshot missing')

    const collector = createBotCommandCollector()
    const apiIntents: ColonyBenchApiIntentLogEntry[] = []
    const botSnapshot = cloneRunnerValue(snapshot)
    await bot.loop({
      runId,
      tick: snapshot.tick,
      snapshot: botSnapshot,
      commands: collector.commands,
      memory,
      game: createColonyBenchGame({
        snapshot: botSnapshot,
        commands: collector.commands,
        memory: memory as ColonyBenchApiMemory,
        apiIntents,
      }),
    })

    const commands = collector.drain()
    const frameEvents: ColonyBenchWorldEventSummary[] = []
    commandLog.push({
      tick: snapshot.tick,
      commands: cloneRunnerValue(commands),
    })

    for (const command of commands) {
      const beforeCommandSnapshot = await app.liveWorldSnapshot({ runId })
      await applyBotCommand({ app, runId, command })
      const commandSnapshot = await app.liveWorldSnapshot({ runId })
      const commandEvents = appendedEventsBetween(
        beforeCommandSnapshot,
        commandSnapshot,
      )
      frameEvents.push(
        ...(commandEvents.length > 0
          ? commandEvents
          : [latestEventFromSnapshot(commandSnapshot)]),
      )
    }

    await app.advanceTick({ runId })
    const nextSnapshot = await app.liveWorldSnapshot({ runId })
    frameEvents.push(latestEventFromSnapshot(nextSnapshot))

    const storedNextSnapshot = cloneRunnerValue(nextSnapshot)
    snapshots.push(storedNextSnapshot)

    yield {
      runId,
      tick: storedNextSnapshot.tick,
      snapshot: cloneRunnerValue(storedNextSnapshot),
      commands: cloneRunnerValue(commands),
      apiIntents: cloneRunnerValue(apiIntents),
      events: cloneRunnerValue(frameEvents),
      memory: cloneRunnerValue(memory),
    }
  }

  const finalSnapshot = snapshots[snapshots.length - 1]
  if (!finalSnapshot) throw new Error('runner final snapshot missing')

  return {
    runId,
    ticks,
    memory,
    snapshots,
    commandLog,
    finalSnapshot,
  }
}

export async function runColonyBenchLoop<
  TMemory extends object = ColonyBenchBotMemory,
>(
  options: RunColonyBenchLoopOptions<TMemory>,
): Promise<RunColonyBenchLoopResult<TMemory>> {
  const iterator = streamColonyBenchLoop(options)[Symbol.asyncIterator]()

  while (true) {
    const result = await iterator.next()
    if (result.done) return result.value
  }
}
