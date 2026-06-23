const DEFAULT_TOOL_NAMES = [
  'inspectWorkspace',
  'readFile',
  'searchFiles',
] as const
const DEFAULT_CHUNKS = [
  'Working on it.',
  'I found a likely cause.',
  'Here is the result.',
] as const

type SimulatedAgentMode = 'demo' | 'test'

type SimulatedAgentPlan = {
  mode: SimulatedAgentMode
  seed: number
}

export function getSimulatedAgentPlan(runId: string): SimulatedAgentPlan {
  const mode = isTestMode() ? 'test' : 'demo'
  const seed = readSeed(runId)

  return { mode, seed }
}

export function shouldFailRun(_seed: number, runId: string) {
  if (isTestMode()) return runId.includes('fail')
  return false
}

export function pickToolName(seed: number, runId: string) {
  if (isTestMode()) return 'searchFiles'
  return DEFAULT_TOOL_NAMES[pick(seed, runId, 1) % DEFAULT_TOOL_NAMES.length]
}

export function buildStreamChunks(seed: number, runId: string) {
  if (isTestMode()) return ['I found ', 'the issue.']
  const first = DEFAULT_CHUNKS[pick(seed, runId, 2) % DEFAULT_CHUNKS.length]
  const second = DEFAULT_CHUNKS[pick(seed, runId, 3) % DEFAULT_CHUNKS.length]
  const chunks = [first, second].filter(
    (chunk, index, items) => chunk && items.indexOf(chunk) === index,
  )

  return chunks.map((chunk, index) =>
    index === chunks.length - 1 ? chunk : `${chunk} `,
  )
}

export function buildFailureMessage(toolName: string) {
  return `Simulated Agent failed while running ${toolName}.`
}

function isTestMode() {
  return (
    process.env.SPECTER_CODE_SIMULATED_AGENT_MODE === 'test' ||
    Boolean(process.env.VITEST)
  )
}

function readSeed(runId: string) {
  const raw = process.env.SPECTER_CODE_SIMULATED_AGENT_SEED
  if (raw) return Number(raw)

  return isTestMode() ? 7 : hash(runId)
}

function pick(seed: number, runId: string, salt: number) {
  return hash(`${seed}:${runId}:${salt}`)
}

function hash(input: string) {
  let value = 2166136261

  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index)
    value = Math.imul(value, 16777619)
  }

  return value >>> 0
}
