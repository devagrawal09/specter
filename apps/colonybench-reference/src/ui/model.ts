import type {
  ColonyBenchRunFrameSummary,
  ColonyBenchRunOverview,
  ColonyBenchRunStatus,
} from '../control/state'
import type {
  ColonyBenchApiIntentLogEntry,
  ColonyBenchApiReturnCode,
} from '../api/game'
import type { ColonyBenchRunFrame } from '../runner/run-loop'
import type { ColonyBenchBotCommand } from '../runner/types'
import {
  BASE_UPGRADE_ENERGY_REQUIRED,
  SOURCE_MAX_ENERGY,
  type ColonyBenchPosition,
  type ColonyBenchWorldEventSummary,
} from '../simulation/state'

export type ColonyBenchMetric = {
  label: string
  value: string
}

export type ColonyBenchFrameRow = {
  tick: number
  score: number
  workerCount: number
  baseLevel: number
  baseEnergy: number
  commandCount: number
  eventTypes: string[]
}

export type ColonyBenchViewModel = {
  title: 'ColonyBench'
  runName: string
  status: ColonyBenchRunStatus | 'idle'
  frameCount: number
  metrics: ColonyBenchMetric[]
  recentFrames: ColonyBenchFrameRow[]
}

export type ColonyBenchGameStatus = 'idle' | 'running' | 'completed'

export type ColonyBenchBoardBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export type ColonyBenchEntityMeter = {
  kind: 'energy' | 'progress' | 'durability'
  label: string
  value: number
  max: number
}

export type ColonyBenchCellEntity = {
  kind:
    | 'base'
    | 'controller'
    | 'worker'
    | 'source'
    | 'constructionSite'
    | 'road'
    | 'terrain'
    | 'intent'
  id: string
  label: string
  detail: string
  meter?: ColonyBenchEntityMeter
  relatedEntityId?: string
}

export type ColonyBenchBoardCell = ColonyBenchPosition & {
  entities: ColonyBenchCellEntity[]
}

export type ColonyBenchSelectedCellDetails = {
  title: string
  details: string[]
}

export type ColonyBenchGameModel = {
  status: ColonyBenchGameStatus
  frameCount: number
  tick: number
  score: number
  bounds: ColonyBenchBoardBounds
  cells: ColonyBenchBoardCell[]
  metrics: ColonyBenchMetric[]
  recentCommands: string[]
  recentApiIntents: string[]
  recentEvents: string[]
  activityHistory: string[]
  baseDetails: string[]
  workerDetails: { id: string; detail: string; activity: string }[]
  sourceDetails: { id: string; detail: string; activity: string }[]
  constructionDetails: { id: string; detail: string; activity: string }[]
  selectedCellDetails: ColonyBenchSelectedCellDetails | null
}

export function buildColonyBenchViewModel({
  overview,
  timeline,
}: {
  overview: ColonyBenchRunOverview
  timeline: ColonyBenchRunFrameSummary[]
}): ColonyBenchViewModel {
  const latestFrame = overview.latestFrame

  return {
    title: 'ColonyBench',
    runName: overview.run?.name ?? 'Baseline simulation',
    status: overview.run?.status ?? 'idle',
    frameCount: overview.frameCount,
    metrics: [
      { label: 'Tick', value: String(latestFrame?.tick ?? 0) },
      { label: 'Score', value: String(latestFrame?.score ?? 0) },
      { label: 'Workers', value: String(latestFrame?.workerCount ?? 0) },
      { label: 'Base level', value: String(latestFrame?.baseLevel ?? 0) },
      { label: 'Base energy', value: String(latestFrame?.baseEnergy ?? 0) },
    ],
    recentFrames: timeline
      .slice(-10)
      .reverse()
      .map((frame) => ({
        tick: frame.tick,
        score: frame.score,
        workerCount: frame.workerCount,
        baseLevel: frame.baseLevel,
        baseEnergy: frame.baseEnergy,
        commandCount: frame.commandCount,
        eventTypes: [...frame.eventTypes],
      })),
  }
}

function cellKey(position: ColonyBenchPosition) {
  return `${position.x},${position.y}`
}

function formatEventType(type: string) {
  return (
    type
      .replace(/^colonybench/, '')
      .replace(/[A-Z]/g, ' $&')
      .trim() || type
  )
}

function formatCommand(command: ColonyBenchBotCommand) {
  switch (command.type) {
    case 'move':
      return `${command.workerId} move to ${command.target.x},${command.target.y}`
    case 'harvest':
      return `${command.workerId} harvest ${command.sourceId}`
    case 'deposit':
      return `${command.workerId} deposit`
    case 'upgrade':
      return `${command.workerId} upgrade base`
    case 'build':
      return `${command.workerId} build ${command.siteId}`
    case 'repair':
      return `${command.workerId} repair ${command.roadId}`
    case 'spawnWorker':
      return 'spawn worker'
  }
}

function formatHistoryCommand(command: ColonyBenchBotCommand) {
  switch (command.type) {
    case 'move':
      return `Move: ${command.workerId} to ${command.target.x},${command.target.y}`
    case 'harvest':
      return `Harvest: ${command.workerId} from ${command.sourceId}`
    case 'deposit':
      return `Deposit: ${command.workerId}`
    case 'upgrade':
      return `Upgrade: ${command.workerId}`
    case 'build':
      return `Build: ${command.workerId} on ${command.siteId}`
    case 'repair':
      return `Repair: ${command.workerId} on ${command.roadId}`
    case 'spawnWorker':
      return 'Spawn: new worker'
  }
}

function returnCodeLabel(code: ColonyBenchApiReturnCode) {
  switch (code) {
    case 0:
      return 'OK'
    case -6:
      return 'ERR_NOT_ENOUGH_RESOURCES'
    case -7:
      return 'ERR_INVALID_TARGET'
    case -9:
      return 'ERR_NOT_IN_RANGE'
    default:
      return `ERR_${code}`
  }
}

function formatApiIntent(intent: ColonyBenchApiIntentLogEntry) {
  const target = intent.targetId
    ? ` ${intent.targetId}`
    : intent.target
      ? ` ${intent.target.x},${intent.target.y}`
      : intent.message
        ? ` “${intent.message}”`
        : ''
  return `${intent.actorId} ${intent.action}${target} → ${returnCodeLabel(intent.code)}`
}

function eventPayload(event: ColonyBenchWorldEventSummary) {
  return event.payload && typeof event.payload === 'object'
    ? (event.payload as Record<string, unknown>)
    : {}
}

function stringPayloadValue(payload: Record<string, unknown>, key: string) {
  const value = payload[key]
  return typeof value === 'string' ? value : null
}

function numberPayloadValue(payload: Record<string, unknown>, key: string) {
  const value = payload[key]
  return typeof value === 'number' ? value : null
}

function formatEvent(event: ColonyBenchWorldEventSummary) {
  const payload = eventPayload(event)
  const type = formatEventType(event.type)
  const workerId = stringPayloadValue(payload, 'workerId')
  const sourceId = stringPayloadValue(payload, 'sourceId')
  const amount = numberPayloadValue(payload, 'amount')

  switch (event.type) {
    case 'colonybenchEnergyDeposited':
    case 'colonybenchWorkerDeposited':
      return `${type}: ${workerId ?? 'worker'} deposited energy`
    case 'colonybenchEnergyHarvested':
    case 'colonybenchWorkerHarvested':
      return `${type}: ${workerId ?? 'worker'} harvested ${amount ?? 'some'} from ${sourceId ?? 'source'}`
    case 'colonybenchBaseUpgraded':
      return `${type}: base reached level ${numberPayloadValue(payload, 'level') ?? '?'}`
    case 'colonybenchWorkerSpawned':
      return `${type}: ${workerId ?? 'worker'} joined the colony`
    case 'colonybenchConstructionSiteBuilt':
      return `${type}: ${workerId ?? 'worker'} built ${amount ?? 'some'} progress`
    case 'colonybenchRoadCompleted':
      return `${type}: road completed`
    case 'colonybenchTickAdvanced': {
      const regeneratedSources = Array.isArray(payload.regeneratedSources)
        ? payload.regeneratedSources.length
        : 0
      return regeneratedSources > 0
        ? `${type}: ${regeneratedSources} source${regeneratedSources === 1 ? '' : 's'} regenerated`
        : type
    }
    default:
      return type
  }
}

function formatRoadDetail(road: { hits: number; hitsMax: number }) {
  return `${road.hits}/${road.hitsMax} hits · road surface`
}

function workerActivity(workerId: string, commands: ColonyBenchBotCommand[]) {
  const command = commands.find(
    (candidate) => 'workerId' in candidate && candidate.workerId === workerId,
  )
  if (!command) return 'Idle'

  switch (command.type) {
    case 'move':
      return `Moving to ${command.target.x},${command.target.y}`
    case 'harvest':
      return `Harvesting ${command.sourceId}`
    case 'deposit':
      return 'Depositing energy'
    case 'upgrade':
      return 'Upgrading base'
    case 'build':
      return `Building ${command.siteId}`
    case 'repair':
      return `Repairing ${command.roadId}`
    default:
      return 'Idle'
  }
}

function workerMemory(frame: ColonyBenchRunFrame | null, workerId: string) {
  const memory = frame?.memory as
    | { creeps?: Record<string, { role?: unknown; saying?: unknown }> }
    | undefined
  return memory?.creeps?.[workerId]
}

function workerRole(frame: ColonyBenchRunFrame | null, workerId: string) {
  const role = workerMemory(frame, workerId)?.role
  return typeof role === 'string' && role.length > 0 ? role : null
}

function workerSaying(frame: ColonyBenchRunFrame | null, workerId: string) {
  const saying = workerMemory(frame, workerId)?.saying
  return typeof saying === 'string' && saying.length > 0 ? saying : null
}

function formatWorkerLoadDetail(
  frame: ColonyBenchRunFrame | null,
  worker: { id: string; energy: number; capacity: number },
) {
  const role = workerRole(frame, worker.id)
  const saying = workerSaying(frame, worker.id)
  const parts = [role, `${worker.energy}/${worker.capacity}`]
  if (saying) parts.push(`says “${saying}”`)
  return parts.filter(Boolean).join(' · ')
}

function formatWorkerRosterDetail({
  frame,
  workerId,
  location,
  energy,
  capacity,
}: {
  frame: ColonyBenchRunFrame | null
  workerId: string
  location: string
  energy: number
  capacity: number
}) {
  const role = workerRole(frame, workerId)
  const saying = workerSaying(frame, workerId)
  const carried = `At ${location} carrying ${energy}/${capacity} energy`
  const parts = [
    role ? `Role ${role}` : null,
    saying ? `Says “${saying}”` : null,
    carried,
  ]
  return parts.filter(Boolean).join(' · ')
}

function samePosition(left: ColonyBenchPosition, right: ColonyBenchPosition) {
  return left.x === right.x && left.y === right.y
}

type BotCommandTargetMarker = {
  id: string
  position: ColonyBenchPosition
  label: string
  detail: string
  relatedEntityId: string
}

function commandTargetMarker(
  command: ColonyBenchBotCommand,
): BotCommandTargetMarker | null {
  if (command.type !== 'move') return null

  return {
    id: `move-target-${command.workerId}`,
    position: command.target,
    label: 'move target',
    detail: `${command.workerId} is moving here`,
    relatedEntityId: command.workerId,
  }
}

function commandTargetMarkers(frame: ColonyBenchRunFrame | null) {
  return (frame?.commands ?? [])
    .map(commandTargetMarker)
    .filter((marker): marker is BotCommandTargetMarker => marker !== null)
}

function lookAtStackFor(
  snapshot: ColonyBenchRunFrame['snapshot'] | undefined,
  selectedCell: ColonyBenchPosition,
) {
  if (!snapshot) return []

  const stack: string[] = []
  for (const tile of snapshot.terrain ?? []) {
    if (samePosition(tile.position, selectedCell))
      stack.push(`terrain ${tile.terrain}`)
  }
  for (const source of snapshot.sources ?? []) {
    if (samePosition(source.position, selectedCell))
      stack.push(`source ${source.id}`)
  }
  if (
    snapshot.controller &&
    samePosition(snapshot.controller.position, selectedCell)
  ) {
    stack.push(`structure ${snapshot.controller.id}`)
  }
  if (snapshot.base && samePosition(snapshot.base.position, selectedCell)) {
    stack.push(`structure ${snapshot.base.id}`)
  }
  for (const road of snapshot.roads ?? []) {
    if (samePosition(road.position, selectedCell))
      stack.push(`structure ${road.id}`)
  }
  for (const site of snapshot.constructionSites ?? []) {
    if (samePosition(site.position, selectedCell))
      stack.push(`constructionSite ${site.id}`)
  }
  for (const worker of snapshot.workers ?? []) {
    if (samePosition(worker.position, selectedCell))
      stack.push(`creep ${worker.id}`)
  }
  return stack
}

function selectedCellDetailsFor({
  frame,
  selectedCell,
}: {
  frame: ColonyBenchRunFrame | null
  selectedCell: ColonyBenchPosition | null
}): ColonyBenchSelectedCellDetails | null {
  if (!selectedCell) return null

  const snapshot = frame?.snapshot
  const details: string[] = []
  const lookAtStack = lookAtStackFor(snapshot, selectedCell)
  if (lookAtStack.length > 0)
    details.push(`API lookAt stack: ${lookAtStack.join(', ')}`)
  if (snapshot?.base && samePosition(snapshot.base.position, selectedCell)) {
    details.push(
      `Base ${snapshot.base.id}: level ${snapshot.base.level} · ${snapshot.base.energy} energy · upgrade ${snapshot.base.upgradeProgress}/10`,
    )
  }

  if (
    snapshot?.controller &&
    samePosition(snapshot.controller.position, selectedCell)
  ) {
    details.push(
      `Controller ${snapshot.controller.id}: level ${snapshot.controller.level} · upgrade ${snapshot.controller.progress}/${snapshot.controller.progressTotal}`,
    )
  }

  for (const source of snapshot?.sources ?? []) {
    if (samePosition(source.position, selectedCell)) {
      details.push(`Source ${source.id}: ${source.energy} energy`)
    }
  }

  for (const tile of snapshot?.terrain ?? []) {
    if (samePosition(tile.position, selectedCell)) {
      details.push(`Terrain: ${tile.terrain} (impassable)`)
    }
  }

  for (const road of snapshot?.roads ?? []) {
    if (samePosition(road.position, selectedCell)) {
      details.push(`Road ${road.id}: ${formatRoadDetail(road)}`)
    }
  }

  for (const site of snapshot?.constructionSites ?? []) {
    if (samePosition(site.position, selectedCell)) {
      details.push(
        `Construction ${site.id}: ${site.structureType} · ${site.progress}/${site.progressTotal} built`,
      )
    }
  }

  for (const worker of snapshot?.workers ?? []) {
    if (samePosition(worker.position, selectedCell)) {
      const role = workerRole(frame, worker.id) ?? 'unassigned'
      const saying = workerSaying(frame, worker.id)
      const speech = saying ? ` · says “${saying}”` : ''
      details.push(
        `Worker ${worker.id}: ${role}${speech} · carrying ${worker.energy}/${worker.capacity} · ${workerActivity(worker.id, frame?.commands ?? [])}`,
      )
    }
  }

  return {
    title: `Cell ${selectedCell.x},${selectedCell.y}`,
    details: details.length > 0 ? details : ['No objects on this cell.'],
  }
}

function boardBoundsFor(
  frame: ColonyBenchRunFrame | null,
): ColonyBenchBoardBounds {
  if (!frame?.snapshot.base) return { minX: -2, maxX: 2, minY: -2, maxY: 2 }

  const positions = [
    frame.snapshot.base.position,
    ...(frame.snapshot.controller ? [frame.snapshot.controller.position] : []),
    ...frame.snapshot.workers.map((worker) => worker.position),
    ...frame.snapshot.sources.map((source) => source.position),
    ...frame.snapshot.constructionSites.map((site) => site.position),
    ...frame.snapshot.roads.map((road) => road.position),
    ...(frame.snapshot.terrain ?? []).map((tile) => tile.position),
  ]

  return {
    minX: Math.min(...positions.map((position) => position.x)) - 1,
    maxX: Math.max(...positions.map((position) => position.x)) + 1,
    minY: Math.min(...positions.map((position) => position.y)) - 1,
    maxY: Math.max(...positions.map((position) => position.y)) + 1,
  }
}

export function buildColonyBenchGameModel({
  frame,
  status,
  frameCount,
  selectedCell = null,
}: {
  frame: ColonyBenchRunFrame | null
  status: ColonyBenchGameStatus
  frameCount: number
  selectedCell?: ColonyBenchPosition | null
}): ColonyBenchGameModel {
  const bounds = boardBoundsFor(frame)
  const entityMap = new Map<string, ColonyBenchCellEntity[]>()
  const snapshot = frame?.snapshot

  if (snapshot?.base) {
    entityMap.set(cellKey(snapshot.base.position), [
      {
        kind: 'base',
        id: snapshot.base.id,
        label: `Base L${snapshot.base.level}`,
        detail: `${snapshot.base.energy} energy`,
        meter: {
          kind: 'progress',
          label: `Base upgrade ${snapshot.base.upgradeProgress}/${BASE_UPGRADE_ENERGY_REQUIRED}`,
          value: snapshot.base.upgradeProgress,
          max: BASE_UPGRADE_ENERGY_REQUIRED,
        },
      },
    ])
  }

  if (snapshot?.controller) {
    const key = cellKey(snapshot.controller.position)
    entityMap.set(key, [
      ...(entityMap.get(key) ?? []),
      {
        kind: 'controller',
        id: snapshot.controller.id,
        label: `Controller L${snapshot.controller.level}`,
        detail: `${snapshot.controller.progress}/${snapshot.controller.progressTotal} upgrade`,
        meter: {
          kind: 'progress',
          label: `Controller upgrade ${snapshot.controller.progress}/${snapshot.controller.progressTotal}`,
          value: snapshot.controller.progress,
          max: snapshot.controller.progressTotal,
        },
      },
    ])
  }

  for (const source of snapshot?.sources ?? []) {
    const key = cellKey(source.position)
    entityMap.set(key, [
      ...(entityMap.get(key) ?? []),
      {
        kind: 'source',
        id: source.id,
        label: source.id,
        detail: `${source.energy} energy`,
        meter: {
          kind: 'energy',
          label: `${source.id} energy ${source.energy}/${SOURCE_MAX_ENERGY}`,
          value: source.energy,
          max: SOURCE_MAX_ENERGY,
        },
      },
    ])
  }

  for (const marker of commandTargetMarkers(frame)) {
    const key = cellKey(marker.position)
    entityMap.set(key, [
      ...(entityMap.get(key) ?? []),
      {
        kind: 'intent',
        id: marker.id,
        label: marker.label,
        detail: marker.detail,
        relatedEntityId: marker.relatedEntityId,
      },
    ])
  }

  for (const tile of snapshot?.terrain ?? []) {
    const key = cellKey(tile.position)
    entityMap.set(key, [
      ...(entityMap.get(key) ?? []),
      {
        kind: 'terrain',
        id: tile.id,
        label: tile.terrain,
        detail: 'impassable terrain',
      },
    ])
  }

  for (const road of snapshot?.roads ?? []) {
    const key = cellKey(road.position)
    entityMap.set(key, [
      ...(entityMap.get(key) ?? []),
      {
        kind: 'road',
        id: road.id,
        label: 'road',
        detail: formatRoadDetail(road),
        meter: {
          kind: 'durability',
          label: `road durability ${road.hits}/${road.hitsMax}`,
          value: road.hits,
          max: road.hitsMax,
        },
      },
    ])
  }

  for (const site of snapshot?.constructionSites ?? []) {
    const key = cellKey(site.position)
    entityMap.set(key, [
      ...(entityMap.get(key) ?? []),
      {
        kind: 'constructionSite',
        id: site.id,
        label: `${site.structureType} site`,
        detail: `${site.progress}/${site.progressTotal} built`,
        meter: {
          kind: 'progress',
          label: `${site.structureType} site progress ${site.progress}/${site.progressTotal}`,
          value: site.progress,
          max: site.progressTotal,
        },
      },
    ])
  }

  for (const worker of snapshot?.workers ?? []) {
    const key = cellKey(worker.position)
    entityMap.set(key, [
      ...(entityMap.get(key) ?? []),
      {
        kind: 'worker',
        id: worker.id,
        label: worker.id,
        detail: formatWorkerLoadDetail(frame, worker),
        meter: {
          kind: 'energy',
          label: `${worker.id} energy ${worker.energy}/${worker.capacity}`,
          value: worker.energy,
          max: worker.capacity,
        },
      },
    ])
  }

  const cells: ColonyBenchBoardCell[] = []
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      cells.push({ x, y, entities: entityMap.get(cellKey({ x, y })) ?? [] })
    }
  }

  const base = snapshot?.base
  const workers = snapshot?.workers ?? []
  const damagedRoads = (snapshot?.roads ?? []).filter(
    (road) => road.hits < road.hitsMax,
  )
  const commands = frame?.commands ?? []
  const recentEvents = (frame?.events ?? []).map(formatEvent)
  const recentApiIntents = (frame?.apiIntents ?? []).map(formatApiIntent)

  return {
    status,
    frameCount,
    tick: snapshot?.tick ?? 0,
    score: snapshot?.score ?? 0,
    bounds,
    cells,
    metrics: [
      { label: 'Tick', value: String(snapshot?.tick ?? 0) },
      { label: 'Score', value: String(snapshot?.score ?? 0) },
      { label: 'Base level', value: String(base?.level ?? 0) },
      { label: 'Base energy', value: String(base?.energy ?? 0) },
      { label: 'Workers', value: String(workers.length) },
      {
        label: 'Sites',
        value: String(snapshot?.constructionSites.length ?? 0),
      },
      { label: 'Roads', value: String(snapshot?.roads.length ?? 0) },
      { label: 'Damaged roads', value: String(damagedRoads.length) },
    ],
    recentCommands: commands.map(formatCommand),
    recentApiIntents,
    recentEvents,
    activityHistory: [
      ...recentEvents,
      ...commands.map(formatHistoryCommand),
    ].slice(0, 8),
    baseDetails: base
      ? [
          `Level ${base.level} base at ${base.position.x},${base.position.y}`,
          `${base.energy} stored energy`,
          `${base.upgradeProgress}/10 upgrade progress`,
        ]
      : ['No active base. Start or step the run.'],
    workerDetails: workers.map((worker) => ({
      id: worker.id,
      detail: formatWorkerRosterDetail({
        frame,
        workerId: worker.id,
        location:
          base &&
          worker.position.x === base.position.x &&
          worker.position.y === base.position.y
            ? 'base'
            : `${worker.position.x},${worker.position.y}`,
        energy: worker.energy,
        capacity: worker.capacity,
      }),
      activity: workerActivity(worker.id, commands),
    })),
    sourceDetails: (snapshot?.sources ?? []).map((source) => {
      const nearbyWorkers = workers.filter(
        (worker) =>
          Math.abs(worker.position.x - source.position.x) +
            Math.abs(worker.position.y - source.position.y) <=
          1,
      )
      return {
        id: source.id,
        detail: `${source.energy} energy at ${source.position.x},${source.position.y}`,
        activity:
          nearbyWorkers.length > 0
            ? `${nearbyWorkers.map((worker) => worker.id).join(', ')} nearby`
            : 'Untapped',
      }
    }),
    constructionDetails: (snapshot?.constructionSites ?? []).map((site) => ({
      id: site.id,
      detail: `${site.structureType} at ${site.position.x},${site.position.y} · ${site.progress}/${site.progressTotal} built`,
      activity: 'Buildable',
    })),
    selectedCellDetails: selectedCellDetailsFor({ frame, selectedCell }),
  }
}
