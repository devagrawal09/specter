import type { ProviderModelRef } from './llm-provider'

export type AgentMode = 'primary' | 'subagent' | 'all'

export type AgentSummary = {
  id: string
  name: string
  description?: string
  mode: AgentMode
  native: boolean
  hidden: boolean
  default: boolean
  model?: ProviderModelRef
  variant?: string
  prompt?: string
  tools: string[]
  temperature?: number
  topP?: number
  color?: string
  steps?: number
  options: Record<string, unknown>
}

export type SpecterCodeAgentRegistryConfig = {
  defaultAgent?: string
  agent?: Record<string, unknown>
}

export type CreateAgentRegistryOptions = {
  config?: SpecterCodeAgentRegistryConfig
}

type AgentCatalogEntry = Omit<
  AgentSummary,
  'default' | 'model' | 'prompt' | 'temperature' | 'topP' | 'variant' | 'color' | 'steps'
> & {
  model?: ProviderModelRef
  prompt?: string
}

const BUILT_IN_AGENTS: Record<string, AgentCatalogEntry> = {
  build: {
    id: 'build',
    name: 'Build',
    description: 'Default coding agent for editing, testing, and explaining a project.',
    mode: 'primary',
    native: true,
    hidden: false,
    tools: [
      'apply_patch',
      'edit',
      'glob',
      'grep',
      'question',
      'read',
      'shell',
      'todo',
      'write',
    ],
    options: {},
  },
  plan: {
    id: 'plan',
    name: 'Plan',
    description: 'Primary planning agent that can inspect context without changing files.',
    mode: 'primary',
    native: true,
    hidden: false,
    tools: ['glob', 'grep', 'question', 'read', 'todo'],
    options: {},
  },
  review: {
    id: 'review',
    name: 'Review',
    description: 'Primary review agent for inspecting diffs and surfacing risks.',
    mode: 'primary',
    native: true,
    hidden: false,
    tools: ['glob', 'grep', 'read'],
    options: {},
  },
}

export class AgentRegistry {
  readonly #agents: AgentSummary[]
  readonly #defaultAgentId: string

  constructor(agents: AgentSummary[], defaultAgentId: string) {
    this.#agents = agents
    this.#defaultAgentId = defaultAgentId
  }

  listAgents() {
    return this.#agents.map((agent) => this.#cloneAgent(agent))
  }

  listPrimaryAgents() {
    return this.#agents
      .filter((agent) => !agent.hidden && isPrimaryMode(agent.mode))
      .map((agent) => this.#cloneAgent(agent))
  }

  requireAgent(agentId: string) {
    const agent = this.#agents.find((candidate) => candidate.id === agentId)
    if (!agent) throw new Error(`Unknown agent: ${agentId}`)
    return this.#cloneAgent(agent)
  }

  resolveDefaultAgent() {
    return this.requireAgent(this.#defaultAgentId)
  }

  #cloneAgent(agent: AgentSummary) {
    return {
      ...agent,
      default: agent.id === this.#defaultAgentId,
      model: agent.model ? { ...agent.model } : undefined,
      tools: [...agent.tools],
      options: { ...agent.options },
    }
  }
}

export function createAgentRegistry(options: CreateAgentRegistryOptions = {}) {
  const configuredAgents = options.config?.agent ?? {}
  const agentIds = new Set([
    ...Object.keys(BUILT_IN_AGENTS),
    ...Object.keys(configuredAgents),
  ])

  const agents = [...agentIds]
    .map((agentId) => buildAgentSummary(agentId, configuredAgents[agentId]))
    .filter((agent): agent is AgentSummary => Boolean(agent))

  const requestedDefault = options.config?.defaultAgent
  const defaultAgentId = selectDefaultAgentId(agents, requestedDefault)
  return new AgentRegistry(agents, defaultAgentId)
}

function buildAgentSummary(agentId: string, value: unknown): AgentSummary | undefined {
  const builtIn = BUILT_IN_AGENTS[agentId]
  const config = readAgentConfig(value)
  if (config.disable) return undefined

  const mode = config.mode ?? builtIn?.mode ?? 'primary'
  const tools = readTools(value, builtIn?.tools ?? [])

  return {
    id: agentId,
    name: humanizeAgentId(agentId),
    description: config.description ?? builtIn?.description,
    mode,
    native: builtIn?.native ?? false,
    hidden: config.hidden ?? builtIn?.hidden ?? false,
    default: false,
    model: config.model ?? builtIn?.model,
    variant: config.variant,
    prompt: config.prompt ?? builtIn?.prompt,
    tools,
    temperature: config.temperature,
    topP: config.topP,
    color: config.color,
    steps: config.steps,
    options: config.options,
  }
}

function readAgentConfig(value: unknown) {
  if (!isRecord(value)) {
    return {
      tools: undefined,
      options: {},
    }
  }

  return {
    model: parseModel(value.model),
    variant: typeof value.variant === 'string' ? value.variant : undefined,
    temperature:
      typeof value.temperature === 'number' ? value.temperature : undefined,
    topP: typeof value.top_p === 'number' ? value.top_p : undefined,
    prompt: typeof value.prompt === 'string' ? value.prompt : undefined,
    disable: value.disable === true,
    description:
      typeof value.description === 'string' ? value.description : undefined,
    mode: readAgentMode(value.mode),
    hidden: typeof value.hidden === 'boolean' ? value.hidden : undefined,
    options: isRecord(value.options) ? { ...value.options } : {},
    color: typeof value.color === 'string' ? value.color : undefined,
    steps:
      typeof value.steps === 'number'
        ? value.steps
        : typeof value.maxSteps === 'number'
          ? value.maxSteps
          : undefined,
  }
}

function readTools(value: unknown, fallback: readonly string[]) {
  if (!isRecord(value) || !isRecord(value.tools)) return [...fallback].sort()
  return Object.entries(value.tools)
    .filter((entry): entry is [string, true] => entry[1] === true)
    .map(([tool]) => tool)
    .sort()
}

function selectDefaultAgentId(agents: readonly AgentSummary[], requested?: string) {
  const eligible = agents.filter((agent) => isPrimaryMode(agent.mode))
  if (requested && eligible.some((agent) => agent.id === requested)) return requested
  if (eligible.some((agent) => agent.id === 'build')) return 'build'
  return eligible[0]?.id ?? agents[0]?.id ?? 'build'
}

function parseModel(model: unknown): ProviderModelRef | undefined {
  if (typeof model !== 'string') return undefined
  const slash = model.indexOf('/')
  if (slash <= 0 || slash === model.length - 1) return undefined
  return {
    providerId: model.slice(0, slash),
    modelId: model.slice(slash + 1),
  }
}

function readAgentMode(value: unknown): AgentMode | undefined {
  if (value === 'primary' || value === 'subagent' || value === 'all') return value
  return undefined
}

function isPrimaryMode(mode: AgentMode) {
  return mode === 'primary' || mode === 'all'
}

function humanizeAgentId(agentId: string) {
  return agentId
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
