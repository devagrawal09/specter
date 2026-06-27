#!/usr/bin/env node
import { spawn } from 'node:child_process'

export type SpecterCodeCliEnvironment = Record<string, string | undefined>

export type SpecterCodeProcessRequest = {
  command: string
  args: string[]
  cwd: string
  env: SpecterCodeCliEnvironment
}

export type SpecterCodeProcessRunner = (
  input: SpecterCodeProcessRequest,
) => Promise<SpecterCodeCliResult>

export type SpecterCodeCliOptions = {
  cwd?: string
  env?: SpecterCodeCliEnvironment
  runProcess?: SpecterCodeProcessRunner
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
  session show <id>   Show a session transcript from local persistence
  import <file>       Import a Specter Code session export file
  export --session <id> --output <file>
                      Export a session and its causal event history
  providers           List configured LLM providers
  models              List available provider models
  agents              List available coding agents
  --help, help        Show this help
`

export function buildSpecterCodeCli(options: SpecterCodeCliOptions = {}) {
  const cwd = options.cwd ?? process.cwd()
  const env = options.env ?? process.env
  const runProcess = options.runProcess ?? runLocalProcess

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
            return runSessionCommand(parsed.rest, env)
          case 'import':
            return runImportCommand(parsed.rest)
          case 'export':
            return runExportCommand(parsed.rest)
          case 'run':
            return runPromptCommand(parsed.rest, { cwd, env })
          case 'serve':
            return runServeCommand(parsed.rest, { cwd, env, runProcess })
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
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv
  const [first = 'help', ...rest] = normalizedArgv
  if (first === '--help' || first === '-h' || first === 'help') {
    return { command: 'help', rest }
  }
  return { command: first, rest }
}

type ServeCommandOptions = {
  cwd: string
  env: SpecterCodeCliEnvironment
  runProcess: SpecterCodeProcessRunner
}

async function runPromptCommand(
  argv: readonly string[],
  options: { cwd: string; env: SpecterCodeCliEnvironment },
) {
  const { runSpecterCodePrompt } = await import('./run.ts')
  return runSpecterCodePrompt({ argv, cwd: options.cwd, env: options.env })
}

async function runServeCommand(
  argv: readonly string[],
  options: ServeCommandOptions,
) {
  const args = ['--filter', '@specter/specter-code', 'dev']

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--host') {
      args.push('--host', optionValue(argv, index, '--host'))
      index += 1
      continue
    }
    if (arg === '--port' || arg === '-p') {
      args.push('--port', optionValue(argv, index, arg))
      index += 1
      continue
    }
    if (arg === '--help' || arg === '-h') {
      return ok('Usage: specter-code serve [--host <host>] [--port <port>]\n')
    }
    return fail(`Unknown serve option: ${arg}\n\nUsage: specter-code serve [--host <host>] [--port <port>]\n`, 1)
  }

  return options.runProcess({
    command: 'pnpm',
    args,
    cwd: options.cwd,
    env: options.env,
  })
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

async function runSessionCommand(
  argv: readonly string[],
  env: SpecterCodeCliEnvironment,
) {
  if (argv[0] === 'list' && argv.length === 1) {
    return ok(await renderSessionList(env))
  }
  if (argv[0] === 'show' && argv[1] && argv.length === 2) {
    return ok(await renderSessionDetail(argv[1], env))
  }

  return fail(
    `Unknown session command: ${argv[0] ?? ''}

Usage: specter-code session list
       specter-code session show <id>
`,
    1,
  )
}

async function renderSessionList(env: SpecterCodeCliEnvironment) {
  const [{ mkdirSync }, { dirname }, { createClient }, { prepareSpecterSqlite }] =
    await Promise.all([
      import('node:fs'),
      import('node:path'),
      import('@libsql/client/sqlite3'),
      import('../../../db/specter-sqlite.ts'),
    ])
  const sqlitePath = env.SPECTER_CODE_DB_PATH ?? './data/specter-code.db'

  mkdirSync(dirname(sqlitePath), { recursive: true })
  const sqlite = createClient({ url: `file:${sqlitePath}` })

  try {
    await prepareSpecterSqlite(sqlite)
    const result = await sqlite.execute({
      sql: `
        SELECT id, title, directory, agent_id, provider_id, model_id
        FROM specter_code_sessions
        WHERE status != 'deleted'
        ORDER BY updated_at DESC, created_at DESC, id ASC
        LIMIT 100
      `,
      args: [],
    })

    if (result.rows.length === 0) return 'No sessions found.\n'

    return result.rows
      .map((row) => {
        const id = String(row.id)
        const title = String(row.title)
        const agent = String(row.agent_id)
        const model = `${String(row.provider_id)}/${String(row.model_id)}`
        const directory = String(row.directory)
        return `${id}\t${title}\t${agent}\t${model}\t${directory}`
      })
      .join('\n') + '\n'
  } finally {
    sqlite.close()
  }
}

async function renderSessionDetail(sessionId: string, env: SpecterCodeCliEnvironment) {
  const [{ mkdirSync }, { dirname }, { createClient }, { prepareSpecterSqlite }] =
    await Promise.all([
      import('node:fs'),
      import('node:path'),
      import('@libsql/client/sqlite3'),
      import('../../../db/specter-sqlite.ts'),
    ])
  const sqlitePath = env.SPECTER_CODE_DB_PATH ?? './data/specter-code.db'

  mkdirSync(dirname(sqlitePath), { recursive: true })
  const sqlite = createClient({ url: `file:${sqlitePath}` })

  try {
    await prepareSpecterSqlite(sqlite)
    const sessionResult = await sqlite.execute({
      sql: `
        SELECT id, title, directory, agent_id, provider_id, model_id, status
        FROM specter_code_sessions
        WHERE id = ? AND status != 'deleted'
        LIMIT 1
      `,
      args: [sessionId],
    })
    const session = sessionResult.rows[0]
    if (!session) throw new Error(`Session not found: ${sessionId}`)

    const messageResult = await sqlite.execute({
      sql: `
        SELECT role, content
        FROM specter_code_messages
        WHERE session_id = ?
        ORDER BY event_order ASC, created_at ASC, id ASC
      `,
      args: [sessionId],
    })

    const lines = [
      `Session: ${String(session.id)}`,
      `Title: ${String(session.title)}`,
      `Directory: ${String(session.directory)}`,
      `Agent: ${String(session.agent_id)}`,
      `Model: ${String(session.provider_id)}/${String(session.model_id)}`,
      `Status: ${String(session.status)}`,
      '',
      'Transcript:',
    ]

    if (messageResult.rows.length === 0) {
      lines.push('(empty)')
    } else {
      for (const message of messageResult.rows) {
        lines.push(`${String(message.role)}: ${String(message.content)}`)
      }
    }

    return `${lines.join('\n')}\n`
  } finally {
    sqlite.close()
  }
}

async function runImportCommand(argv: readonly string[]) {
  const inputPath = argv[0]
  if (!inputPath || inputPath.startsWith('--') || argv.length > 1) {
    return fail('Usage: specter-code import <file>\n', 1)
  }

  const { importSpecterCodeSessionFile } = await import('../adapters/import-export.ts')
  const result = await importSpecterCodeSessionFile({ inputPath })
  return ok(`Imported session ${result.sessionId} (${result.eventCount} events)\n`)
}

async function runExportCommand(argv: readonly string[]) {
  let sessionId: string | undefined
  let outputPath: string | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--session') {
      sessionId = optionValue(argv, index, '--session')
      index += 1
      continue
    }
    if (arg === '--output' || arg === '-o') {
      outputPath = optionValue(argv, index, arg)
      index += 1
      continue
    }
    return fail('Usage: specter-code export --session <id> --output <file>\n', 1)
  }

  if (!sessionId || !outputPath) {
    return fail('Usage: specter-code export --session <id> --output <file>\n', 1)
  }

  const { exportSpecterCodeSessionFile } = await import('../adapters/import-export.ts')
  const result = await exportSpecterCodeSessionFile({ sessionId, outputPath })
  return ok(`Exported session ${result.sessionId} (${result.eventCount} events) to ${result.outputPath}\n`)
}

function optionValue(argv: readonly string[], index: number, option: string) {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`)
  return value
}


async function runLocalProcess(
  input: SpecterCodeProcessRequest,
): Promise<SpecterCodeCliResult> {
  return new Promise((resolve) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: { ...process.env, ...input.env },
      shell: process.platform === 'win32',
    })
    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      resolve({ exitCode: 1, stdout, stderr: `${stderr}${error.message}\n` })
    })
    child.on('close', (code) => {
      resolve({ exitCode: code ?? 0, stdout, stderr })
    })
  })
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
