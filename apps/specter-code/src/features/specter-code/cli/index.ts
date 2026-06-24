#!/usr/bin/env node
export type SpecterCodeCliEnvironment = Record<string, string | undefined>

export type SpecterCodeCliOptions = {
  cwd?: string
  env?: SpecterCodeCliEnvironment
}

export type SpecterCodeCliResult = {
  exitCode: number
  stdout: string
  stderr: string
}

type ParsedCommand = {
  command: string
  rest: string[]
}

const HELP_TEXT = `Specter Code — OpenCode-compatible local coding assistant

Usage: specter-code [command]

Commands:
  run [message]       Run one non-interactive prompt in the current project
  serve               Start the Specter Code HTTP/web server
  session list        List local coding sessions
  providers           List configured LLM providers
  models              List available provider models
  agents              List available coding agents
  --help, help        Show this help
`

export function buildSpecterCodeCli(options: SpecterCodeCliOptions = {}) {
  const cwd = options.cwd ?? process.cwd()
  const env = options.env ?? process.env

  return {
    async run(argv: readonly string[] = []): Promise<SpecterCodeCliResult> {
      const parsed = parseCommand(argv)
      if (parsed.command === 'help') return ok(HELP_TEXT)

      try {
        switch (parsed.command) {
          case 'providers':
            return ok(await renderProviders(cwd, env))
          case 'models':
            return ok(await renderModels(cwd, env))
          case 'agents':
            return ok(await renderAgents(cwd, env))
          case 'session':
            return runSessionCommand(parsed.rest)
          case 'run':
            return ok(renderRunPreview(parsed.rest))
          case 'serve':
            return ok('Start the web server with: pnpm --filter @specter/specter-code dev\n')
          default:
            return fail(`Unknown command: ${parsed.command}\n\n${HELP_TEXT}`, 1)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return fail(`${message}\n`, 1)
      }
    },
  }
}

function parseCommand(argv: readonly string[]): ParsedCommand {
  const [first = 'help', ...rest] = argv
  if (first === '--help' || first === '-h' || first === 'help') {
    return { command: 'help', rest }
  }
  return { command: first, rest }
}

async function loadCliConfig(cwd: string, env: SpecterCodeCliEnvironment) {
  const { loadSpecterCodeConfig } = await import('../adapters/config-loader.ts')
  return loadSpecterCodeConfig({
    workspaceRoot: cwd,
    env: { OPENCODE_CONFIG_CONTENT: env.OPENCODE_CONFIG_CONTENT },
  })
}

async function renderProviders(cwd: string, env: SpecterCodeCliEnvironment) {
  const [{ createProviderRegistry }, config] = await Promise.all([
    import('../adapters/llm-provider.ts'),
    loadCliConfig(cwd, env),
  ])
  const registry = createProviderRegistry({ config, env })
  const lines = registry.listProviders().map((provider) => {
    const status = provider.configured ? 'configured' : 'missing key'
    const key = provider.apiKeyEnv ? ` key=${provider.apiKeyEnv}` : ''
    const baseUrl = provider.baseUrl ? ` base=${provider.baseUrl}` : ''
    return `${provider.id}\t${provider.name}\t${provider.type}\t${status}${key}${baseUrl}`
  })

  return `${lines.join('\n')}\n`
}

async function renderModels(cwd: string, env: SpecterCodeCliEnvironment) {
  const [{ createProviderRegistry }, config] = await Promise.all([
    import('../adapters/llm-provider.ts'),
    loadCliConfig(cwd, env),
  ])
  const registry = createProviderRegistry({ config, env })
  const defaultModel = registry.resolveDefaultModel()
  const lines = registry.listProviders().flatMap((provider) =>
    provider.models.map((model) => {
      const selector =
        provider.id === defaultModel.providerId && model.id === defaultModel.modelId
          ? '*'
          : ' '
      return `${selector} ${provider.id}/${model.id}\t${model.name}`
    }),
  )

  return `${lines.join('\n')}\n`
}

async function renderAgents(cwd: string, env: SpecterCodeCliEnvironment) {
  const [{ createAgentRegistry }, config] = await Promise.all([
    import('../adapters/agent-registry.ts'),
    loadCliConfig(cwd, env),
  ])
  const registry = createAgentRegistry({ config })
  const lines = registry.listAgents().map((agent) => {
    const marker = agent.default ? '*' : ' '
    const visibility = agent.hidden ? 'hidden' : agent.mode
    return `${marker} ${agent.id}\t${agent.name}\t${visibility}\ttools=${agent.tools.join(',')}`
  })

  return `${lines.join('\n')}\n`
}

function runSessionCommand(argv: readonly string[]) {
  if (argv[0] !== 'list') {
    return fail(`Unknown session command: ${argv[0] ?? ''}\n\nUsage: specter-code session list\n`, 1)
  }

  return ok('No persisted session CLI adapter is configured yet. Use the web UI or HTTP API for sessions.\n')
}

function renderRunPreview(argv: readonly string[]) {
  const message = argv.join(' ').trim()
  if (!message) return 'Usage: specter-code run [message]\n'
  return `Queued non-interactive prompt preview: ${message}\n`
}

function ok(stdout: string): SpecterCodeCliResult {
  return { exitCode: 0, stdout, stderr: '' }
}

function fail(stderr: string, exitCode: number): SpecterCodeCliResult {
  return { exitCode, stdout: '', stderr }
}

async function main() {
  const result = await buildSpecterCodeCli().run(process.argv.slice(2))
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  process.exitCode = result.exitCode
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === new URL(invokedPath, 'file:').href) {
  void main()
}
