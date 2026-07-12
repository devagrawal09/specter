export type ColonyBenchRunStatus = 'created' | 'started' | 'completed'

export type ColonyBenchRun = {
  runId: string
  name: string
  status: ColonyBenchRunStatus
}

export type ColonyBenchRunFrameSummary = {
  runId: string
  tick: number
  score: number
  workerCount: number
  baseLevel: number
  baseEnergy: number
  commandCount: number
  eventTypes: string[]
}

export type ColonyBenchRunOverview = {
  run: ColonyBenchRun | null
  frameCount: number
  latestFrame: ColonyBenchRunFrameSummary | null
}

export type ColonyBenchControlState = {
  runs: Record<string, ColonyBenchRun>
  runOrder: string[]
  bridgedRunIds: string[]
  framesByRunId: Record<string, ColonyBenchRunFrameSummary[]>
}

export function createColonyBenchControlState(): ColonyBenchControlState {
  return {
    runs: {},
    runOrder: [],
    bridgedRunIds: [],
    framesByRunId: {},
  }
}
