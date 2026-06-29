import type { ColonyBenchGame } from '../api/game'
import type {
  ColonyBenchPosition,
  ColonyBenchWorldSnapshot,
} from '../simulation/state'

export type ColonyBenchBotMemory = Record<string, unknown>

export type MoveBotCommand = {
  type: 'move'
  workerId: string
  target: ColonyBenchPosition
}

export type HarvestBotCommand = {
  type: 'harvest'
  workerId: string
  sourceId: string
}

export type DepositBotCommand = {
  type: 'deposit'
  workerId: string
}

export type UpgradeBotCommand = {
  type: 'upgrade'
  workerId: string
}

export type SpawnWorkerBotCommand = {
  type: 'spawnWorker'
}

export type BuildBotCommand = {
  type: 'build'
  workerId: string
  siteId: string
}

export type RepairBotCommand = {
  type: 'repair'
  workerId: string
  roadId: string
}

export type ColonyBenchBotCommand =
  | MoveBotCommand
  | HarvestBotCommand
  | DepositBotCommand
  | UpgradeBotCommand
  | BuildBotCommand
  | RepairBotCommand
  | SpawnWorkerBotCommand

export type ColonyBenchBotCommands = {
  move: (workerId: string, target: ColonyBenchPosition) => void
  harvest: (workerId: string, sourceId: string) => void
  deposit: (workerId: string) => void
  upgrade: (workerId: string) => void
  build: (workerId: string, siteId: string) => void
  repair: (workerId: string, roadId: string) => void
  spawnWorker: () => void
}

export type ColonyBenchBotContext<
  TMemory extends object = ColonyBenchBotMemory,
> = {
  runId: string
  tick: number
  snapshot: ColonyBenchWorldSnapshot
  commands: ColonyBenchBotCommands
  memory: TMemory
  game: ColonyBenchGame
}

export type ColonyBenchBot<TMemory extends object = ColonyBenchBotMemory> = {
  loop: (
    ctx: ColonyBenchBotContext<TMemory>,
  ) => void | Promise<void>
}

export type ColonyBenchBotCommandCollector = {
  commands: ColonyBenchBotCommands
  peek: () => ColonyBenchBotCommand[]
  drain: () => ColonyBenchBotCommand[]
}

function clonePosition(position: ColonyBenchPosition): ColonyBenchPosition {
  return { x: position.x, y: position.y }
}

function cloneCommand(command: ColonyBenchBotCommand): ColonyBenchBotCommand {
  switch (command.type) {
    case 'move':
      return {
        type: 'move',
        workerId: command.workerId,
        target: clonePosition(command.target),
      }
    case 'harvest':
      return {
        type: 'harvest',
        workerId: command.workerId,
        sourceId: command.sourceId,
      }
    case 'deposit':
      return { type: 'deposit', workerId: command.workerId }
    case 'upgrade':
      return { type: 'upgrade', workerId: command.workerId }
    case 'build':
      return { type: 'build', workerId: command.workerId, siteId: command.siteId }
    case 'repair':
      return { type: 'repair', workerId: command.workerId, roadId: command.roadId }
    case 'spawnWorker':
      return { type: 'spawnWorker' }
  }
}

export function createBotCommandCollector(): ColonyBenchBotCommandCollector {
  const recorded: ColonyBenchBotCommand[] = []

  return {
    commands: {
      move(workerId, target) {
        recorded.push({ type: 'move', workerId, target: clonePosition(target) })
      },
      harvest(workerId, sourceId) {
        recorded.push({ type: 'harvest', workerId, sourceId })
      },
      deposit(workerId) {
        recorded.push({ type: 'deposit', workerId })
      },
      upgrade(workerId) {
        recorded.push({ type: 'upgrade', workerId })
      },
      build(workerId, siteId) {
        recorded.push({ type: 'build', workerId, siteId })
      },
      repair(workerId, roadId) {
        recorded.push({ type: 'repair', workerId, roadId })
      },
      spawnWorker() {
        recorded.push({ type: 'spawnWorker' })
      },
    },
    peek() {
      return recorded.map(cloneCommand)
    },
    drain() {
      const drained = recorded.map(cloneCommand)
      recorded.length = 0
      return drained
    },
  }
}
