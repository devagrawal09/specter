import { createHash } from 'node:crypto'

import { renderInteractiveDemoTui } from './tui/demo.ts'
import { createAgentRegistry, type AgentSummary } from '../adapters/agent-registry.ts'
import { loadSpecterCodeConfig } from '../adapters/config-loader.ts'
import { runOpenAICompatibleChatCompletion, type SpecterCodeFetch } from '../adapters/chat-completions.ts'
import { createProviderRegistry } from '../adapters/llm-provider.ts'
import { createSpecterCodeBuiltInToolRegistry } from '../adapters/tool-catalog.ts'
import {
  buildFailureMessage,
  buildStreamChunks,
  getSimulatedAgentPlan,
  pickToolName,
  shouldFailRun,
} from '../simulated-agent-plan.ts'

type SpecterCodeCliEnvironment = Record<string, string | undefined>

type SpecterCodeCliResult = {
  exitCode: number
  stdout: string
  stderr: string
}

type RunFormat = 'text' | 'json'

type RunArguments = {
  format: RunFormat
  interactive: boolean
  demo: boolean
  live: boolean
  message: string
  requestedAgentId?: string
  requestedModel?: string
}

type RunStartedModel = {
  providerId: string
  modelId: string
  configured: boolean
}

type JsonRunEvent =
  | {
      type: 'session.created'
      sessionId: string
      title: string
      directory: string
    }
  | {
      type: 'message.created'
      messageId: string
      sessionId: string
      role: 'user'
      content: string
    }
  | {
      type: 'run.started'
      runId: string
      sessionId: string
      agentId: string
      agentName: string
      model: string
      modelConfigured: boolean
    }
  | {
      type: 'tool.started'
      runId: string
      toolCallId: string
      toolName: string
      inputSummary: string
    }
  | {
      type: 'tool.completed'
      runId: string
      toolCallId: string
      toolName: string
      outputSummary: string
    }
  | {
      type: 'tool.failed'
      runId: string
      toolCallId: string
      toolName: string
      error: string
    }
  | {
      type: 'assistant.delta'
      runId: string
      sequence: number
      delta: string
    }
  | {
      type: 'assistant.message'
      messageId: string
      sessionId: string
      role: 'assistant'
      content: string
    }
  | {
      type: 'run.completed'
      runId: string
      sessionId: string
    }
  | {
      type: 'run.failed'
      runId: string
      sessionId: string
      error: string
    }

export async function runSpecterCodePrompt(options: {
  argv: readonly string[]
  cwd: string
  env: SpecterCodeCliEnvironment
  fetch?: SpecterCodeFetch
}): Promise<SpecterCodeCliResult> {
  const parsed = parseRunArguments(options.argv)
  const message = parsed.message || (parsed.interactive && parsed.demo ? 'Review this project' : '')
  if (!message) {
    return fail('Usage: specter-code run [--live] [--format text|json] [--interactive --demo] [--agent id] [--model provider/model] <message>\n', 1)
  }
  if (parsed.interactive && !parsed.demo) {
    return fail('Interactive TUI smoke mode currently requires --demo.\n', 1)
  }
  if (parsed.live && parsed.interactive) {
    return fail('Live provider runs are only supported in non-interactive mode.\n', 1)
  }

  const config = await loadSpecterCodeConfig({
    workspaceRoot: options.cwd,
    env: { OPENCODE_CONFIG_CONTENT: options.env.OPENCODE_CONFIG_CONTENT },
  })
  const agentRegistry = createAgentRegistry({ config })
  const providerRegistry = createProviderRegistry({ config, env: options.env })
  const agent = parsed.requestedAgentId
    ? agentRegistry.requireAgent(parsed.requestedAgentId)
    : agentRegistry.resolveDefaultAgent()
  const model = resolveRunModel(parsed.requestedModel, agent, providerRegistry)
  const ids = buildRunIds(options.cwd, message, agent.id, model)
  const eventOptions = {
    cwd: options.cwd,
    message,
    agent,
    ids,
    model,
  }
  const events = parsed.interactive
    ? buildMockedRunEvents(eventOptions)
    : parsed.live
      ? await buildLiveRunEvents({
          ...eventOptions,
          providerRegistry,
          env: options.env,
          fetchImpl: options.fetch,
        })
      : await buildRunEvents(eventOptions)

  if (parsed.interactive) {
    return ok(renderInteractiveDemoTui(events, { cwd: options.cwd, prompt: message }))
  }

  if (parsed.format === 'json') {
    return ok(`${events.map((event) => JSON.stringify(event)).join('\n')}\n`)
  }

  return ok(renderTextRun(events))
}

function parseRunArguments(argv: readonly string[]): RunArguments {
  let format: RunFormat = 'text'
  let interactive = false
  let demo = false
  let live = false
  let requestedAgentId: string | undefined
  let requestedModel: string | undefined
  const messageParts: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--format') {
      const value = argv[index + 1]
      if (value !== 'json' && value !== 'text') {
        throw new Error('Run format must be text or json')
      }
      format = value
      index += 1
      continue
    }
    if (arg === '--json') {
      format = 'json'
      continue
    }
    if (arg === '--interactive' || arg === '-i') {
      interactive = true
      continue
    }
    if (arg === '--demo') {
      demo = true
      continue
    }
    if (arg === '--live') {
      live = true
      continue
    }
    if (arg === '--agent') {
      requestedAgentId = requireOptionValue(argv, index, '--agent')
      index += 1
      continue
    }
    if (arg === '--model') {
      requestedModel = requireOptionValue(argv, index, '--model')
      index += 1
      continue
    }
    if (arg.startsWith('--')) {
      throw new Error(`Unknown run option: ${arg}`)
    }
    messageParts.push(arg)
  }

  return {
    format,
    interactive,
    demo,
    live,
    requestedAgentId,
    requestedModel,
    message: messageParts.join(' ').trim(),
  }
}

function requireOptionValue(argv: readonly string[], index: number, option: string) {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`)
  return value
}

function resolveRunModel(
  requestedModel: string | undefined,
  agent: AgentSummary,
  providerRegistry: ReturnType<typeof createProviderRegistry>,
): RunStartedModel {
  if (requestedModel) return parseModelSelector(requestedModel)
  if (agent.model) return { ...agent.model, configured: true }

  const defaultModel = providerRegistry.resolveDefaultModel()
  return {
    providerId: defaultModel.providerId,
    modelId: defaultModel.modelId,
    configured: defaultModel.configured,
  }
}

function parseModelSelector(selector: string): RunStartedModel {
  const slash = selector.indexOf('/')
  if (slash <= 0 || slash === selector.length - 1) {
    throw new Error('Run model must use provider/model format')
  }
  return {
    providerId: selector.slice(0, slash),
    modelId: selector.slice(slash + 1),
    configured: true,
  }
}

function buildRunIds(
  cwd: string,
  message: string,
  agentId: string,
  model: RunStartedModel,
) {
  const digest = createHash('sha256')
    .update([cwd, message, agentId, model.providerId, model.modelId].join('\0'))
    .digest('hex')
    .slice(0, 12)

  return {
    sessionId: `cli-session-${digest}`,
    messageId: `cli-message-${digest}`,
    assistantMessageId: `cli-assistant-${digest}`,
    runId: `cli-run-${digest}`,
    toolCallId: `cli-tool-${digest}`,
  }
}

function buildMockedRunEvents(options: {
  cwd: string
  message: string
  agent: AgentSummary
  ids: ReturnType<typeof buildRunIds>
  model: RunStartedModel
}): JsonRunEvent[] {
  const plan = getSimulatedAgentPlan(options.ids.runId)
  const toolName = pickToolName(plan.seed, options.ids.runId)
  const chunks = buildStreamChunks(plan.seed, options.ids.runId)
  const failure = shouldFailRun(plan.seed, options.ids.runId)
  const events: JsonRunEvent[] = [
    {
      type: 'session.created',
      sessionId: options.ids.sessionId,
      title: summarizeTitle(options.message),
      directory: options.cwd,
    },
    {
      type: 'message.created',
      messageId: options.ids.messageId,
      sessionId: options.ids.sessionId,
      role: 'user',
      content: options.message,
    },
    {
      type: 'run.started',
      runId: options.ids.runId,
      sessionId: options.ids.sessionId,
      agentId: options.agent.id,
      agentName: options.agent.name,
      model: `${options.model.providerId}/${options.model.modelId}`,
      modelConfigured: options.model.configured,
    },
    {
      type: 'tool.started',
      runId: options.ids.runId,
      toolCallId: options.ids.toolCallId,
      toolName,
      inputSummary: 'Mocked local workspace inspection',
    },
  ]

  if (failure) {
    const error = buildFailureMessage(toolName)
    events.push(
      {
        type: 'tool.failed',
        runId: options.ids.runId,
        toolCallId: options.ids.toolCallId,
        toolName,
        error,
      },
      {
        type: 'run.failed',
        runId: options.ids.runId,
        sessionId: options.ids.sessionId,
        error,
      },
    )
    return events
  }

  events.push({
    type: 'tool.completed',
    runId: options.ids.runId,
    toolCallId: options.ids.toolCallId,
    toolName,
    outputSummary: `Mocked ${toolName} output`,
  })

  chunks.forEach((delta, sequence) => {
    events.push({
      type: 'assistant.delta',
      runId: options.ids.runId,
      sequence,
      delta,
    })
  })

  events.push(
    {
      type: 'assistant.message',
      messageId: options.ids.assistantMessageId,
      sessionId: options.ids.sessionId,
      role: 'assistant',
      content: chunks.join(''),
    },
    {
      type: 'run.completed',
      runId: options.ids.runId,
      sessionId: options.ids.sessionId,
    },
  )

  return events
}

async function buildRunEvents(options: {
  cwd: string
  message: string
  agent: AgentSummary
  ids: ReturnType<typeof buildRunIds>
  model: RunStartedModel
}): Promise<JsonRunEvent[]> {
  const localToolPlan = buildLocalToolPlan(options.message)
  if (!localToolPlan) return buildMockedRunEvents(options)

  const events = buildRunStartEvents(options)
  events.push({
    type: 'tool.started',
    runId: options.ids.runId,
    toolCallId: options.ids.toolCallId,
    toolName: localToolPlan.toolName,
    inputSummary: localToolPlan.inputSummary,
  })

  try {
    const registry = createSpecterCodeBuiltInToolRegistry()
    const output = await registry.execute(localToolPlan.toolName, localToolPlan.input, {
      sessionId: options.ids.sessionId,
      messageId: options.ids.messageId,
      agent: options.agent.id,
      workspaceRoot: options.cwd,
      ask: async () => 'allow',
      metadata: () => {},
    })
    const outputSummary = summarizeToolOutput(localToolPlan, output)
    events.push({
      type: 'tool.completed',
      runId: options.ids.runId,
      toolCallId: options.ids.toolCallId,
      toolName: localToolPlan.toolName,
      outputSummary,
    })
    const assistantContent = renderToolAssistantMessage(localToolPlan, output)
    chunkAssistantContent(assistantContent).forEach((delta, sequence) => {
      events.push({
        type: 'assistant.delta',
        runId: options.ids.runId,
        sequence,
        delta,
      })
    })
    events.push(
      {
        type: 'assistant.message',
        messageId: options.ids.assistantMessageId,
        sessionId: options.ids.sessionId,
        role: 'assistant',
        content: assistantContent,
      },
      {
        type: 'run.completed',
        runId: options.ids.runId,
        sessionId: options.ids.sessionId,
      },
    )
    return events
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Tool execution failed'
    events.push(
      {
        type: 'tool.failed',
        runId: options.ids.runId,
        toolCallId: options.ids.toolCallId,
        toolName: localToolPlan.toolName,
        error: message,
      },
      {
        type: 'run.failed',
        runId: options.ids.runId,
        sessionId: options.ids.sessionId,
        error: message,
      },
    )
    return events
  }
}

function buildRunStartEvents(options: {
  cwd: string
  message: string
  agent: AgentSummary
  ids: ReturnType<typeof buildRunIds>
  model: RunStartedModel
}): JsonRunEvent[] {
  return [
    {
      type: 'session.created',
      sessionId: options.ids.sessionId,
      title: summarizeTitle(options.message),
      directory: options.cwd,
    },
    {
      type: 'message.created',
      messageId: options.ids.messageId,
      sessionId: options.ids.sessionId,
      role: 'user',
      content: options.message,
    },
    {
      type: 'run.started',
      runId: options.ids.runId,
      sessionId: options.ids.sessionId,
      agentId: options.agent.id,
      agentName: options.agent.name,
      model: `${options.model.providerId}/${options.model.modelId}`,
      modelConfigured: options.model.configured,
    },
  ]
}

async function buildLiveRunEvents(options: {
  cwd: string
  message: string
  agent: AgentSummary
  ids: ReturnType<typeof buildRunIds>
  model: RunStartedModel
  providerRegistry: ReturnType<typeof createProviderRegistry>
  env: SpecterCodeCliEnvironment
  fetchImpl?: SpecterCodeFetch
}): Promise<JsonRunEvent[]> {
  const events = buildRunStartEvents(options)
  let sequence = 0

  try {
    const provider = options.providerRegistry.requireProvider(options.model.providerId)
    const result = await runOpenAICompatibleChatCompletion({
      provider,
      env: options.env,
      modelId: options.model.modelId,
      messages: [{ role: 'user', content: options.message }],
      fetchImpl: options.fetchImpl,
      onDelta: (delta) => {
        events.push({
          type: 'assistant.delta',
          runId: options.ids.runId,
          sequence,
          delta,
        })
        sequence += 1
      },
    })

    events.push(
      {
        type: 'assistant.message',
        messageId: options.ids.assistantMessageId,
        sessionId: options.ids.sessionId,
        role: 'assistant',
        content: result.content,
      },
      {
        type: 'run.completed',
        runId: options.ids.runId,
        sessionId: options.ids.sessionId,
      },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Live provider run failed'
    events.push({
      type: 'run.failed',
      runId: options.ids.runId,
      sessionId: options.ids.sessionId,
      error: message,
    })
  }

  return events
}

type LocalToolPlan = {
  toolName: string
  input: unknown
  inputSummary: string
  kind: 'grep'
  pattern: string
}

function buildLocalToolPlan(message: string): LocalToolPlan | undefined {
  const grepMatch = /^grep\s+(.+)$/i.exec(message.trim())
  if (!grepMatch) return undefined

  const pattern = grepMatch[1]?.trim()
  if (!pattern) return undefined
  return {
    toolName: 'grep',
    input: { pattern, include: '**/*', maxMatches: 10 },
    inputSummary: `grep ${pattern} in **/*`,
    kind: 'grep',
    pattern,
  }
}

function summarizeToolOutput(plan: LocalToolPlan, output: unknown) {
  if (plan.kind === 'grep') {
    const matches = readGrepMatches(output)
    if (matches.length === 0) return `No matches for ${plan.pattern}`
    return formatGrepMatch(matches[0])
  }
  return 'Tool completed'
}

function renderToolAssistantMessage(plan: LocalToolPlan, output: unknown) {
  if (plan.kind === 'grep') {
    const matches = readGrepMatches(output)
    if (matches.length === 0) return `No matches for "${plan.pattern}".`
    const count = matches.length
    return [
      `Found ${count} match${count === 1 ? '' : 'es'} for "${plan.pattern}".`,
      ...matches.map(formatGrepMatch),
    ].join('\n')
  }
  return summarizeToolOutput(plan, output)
}

type CliGrepMatch = { path: string; lineNumber: number; line: string }

function readGrepMatches(output: unknown): CliGrepMatch[] {
  if (!output || typeof output !== 'object') return []
  const matches = (output as { matches?: unknown }).matches
  if (!Array.isArray(matches)) return []
  return matches.flatMap((match) => {
    if (!match || typeof match !== 'object') return []
    const candidate = match as Partial<CliGrepMatch>
    if (
      typeof candidate.path !== 'string' ||
      typeof candidate.lineNumber !== 'number' ||
      typeof candidate.line !== 'string'
    ) {
      return []
    }
    return [{ path: candidate.path, lineNumber: candidate.lineNumber, line: candidate.line }]
  })
}

function formatGrepMatch(match: CliGrepMatch) {
  return `${match.path}:${match.lineNumber}: ${match.line}`
}

function chunkAssistantContent(content: string) {
  const newline = content.indexOf('\n')
  if (newline >= 0) return [content.slice(0, newline + 1), content.slice(newline + 1)]
  const midpoint = Math.max(1, Math.floor(content.length / 2))
  return [content.slice(0, midpoint), content.slice(midpoint)]
}

function summarizeTitle(message: string) {
  const title = message.trim().replaceAll(/\s+/g, ' ')
  return title.length > 80 ? `${title.slice(0, 77)}...` : title
}

function renderTextRun(events: readonly JsonRunEvent[]) {
  const started = events.find((event) => event.type === 'run.started')
  const message = events.find((event) => event.type === 'assistant.message')
  const failure = events.find((event) => event.type === 'run.failed')

  if (failure?.type === 'run.failed') {
    return `Run ${failure.runId} failed: ${failure.error}\n`
  }

  if (started?.type !== 'run.started' || message?.type !== 'assistant.message') {
    return 'Run did not produce an assistant message.\n'
  }

  return `Specter Code run ${started.runId} using ${started.agentId} on ${started.model}\n${message.content}\n`
}

function ok(stdout: string): SpecterCodeCliResult {
  return { exitCode: 0, stdout, stderr: '' }
}

function fail(stderr: string, exitCode: number): SpecterCodeCliResult {
  return { exitCode, stdout: '', stderr }
}
