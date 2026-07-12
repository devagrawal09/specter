#!/usr/bin/env node
import { spawn } from 'node:child_process'

import type { SpecterCodeFetch } from '../adapters/chat-completions.ts'

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
  fetch?: SpecterCodeFetch
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
  specter-code          Start the interactive TUI
  run [message]       Run one non-interactive prompt in the current project
  serve               Start the Specter Code HTTP/web server
  web                 Start the Specter Code web UI
  session list        List local coding sessions
  session show <id>   Show a session transcript from local persistence
  session new --title <title> [--id <id>] [--workspace <id>]
                      Create a persisted coding session
  session rename <id> <title>
                      Rename a persisted coding session
  session delete <id>
                      Delete a persisted coding session
  import <file>       Import a Specter Code session export file
  export --session <id> --output <file>
                      Export a session and its causal event history
  auth login         Store an OpenCode-compatible provider API credential
  auth list          List authenticated providers
  auth logout <id>   Remove provider credentials
  provider, providers List configured LLM providers
  model, models       List available provider models
  agent, agents       List available coding agents
  stats               Show local usage and persistence statistics
  db path             Print the Specter Code SQLite database path
  db query <sql>      Run a readonly SQL query against local persistence
  mcp list            List configured MCP servers without starting them
  plugin <module>     Register an OpenCode plugin module in config
  debug info          Show troubleshooting diagnostics
  debug paths         Show resolved project/config/database paths
  --help, help        Show this help
`

const SESSION_USAGE = `Usage: specter-code session list
       specter-code session show <id>
       specter-code session new --title <title> [--id <id>] [--workspace <id>] [--directory <path>] [--agent <agent>] [--model <provider/model>]
       specter-code session rename <id> <title>
       specter-code session delete <id>
`

const AUTH_USAGE = `Usage: specter-code auth login --provider <id> --key <api-key> [--description <label>]
       specter-code auth list
       specter-code auth logout <provider>
`
const DB_USAGE = 'Usage: specter-code db path\n       specter-code db query <sql> [--format json|tsv]\n'
const DEBUG_USAGE = 'Usage: specter-code debug info\n       specter-code debug paths\n'

export function buildSpecterCodeCli(options: SpecterCodeCliOptions = {}) {
  const cwd = options.cwd ?? process.cwd()
  const env = options.env ?? process.env
  const runProcess = options.runProcess ?? runLocalProcess
  const fetch = options.fetch

  return {
    async run(argv: readonly string[] = []): Promise<SpecterCodeCliResult> {
      const parsed = parseCommand(argv)
      if (parsed.command === 'help') return ok(HELP_TEXT)

      try {
        switch (parsed.command) {
          case 'providers':
          case 'provider':
            return runCatalogCommand(parsed.rest, parsed.command, () => renderProviders(cwd, env))
          case 'models':
          case 'model':
            return runCatalogCommand(parsed.rest, parsed.command, () => renderModels(cwd, env))
          case 'agents':
          case 'agent':
            return runCatalogCommand(parsed.rest, parsed.command, () => renderAgents(cwd, env))
          case 'auth':
            return runAuthCommand(parsed.rest, env)
          case 'stats':
            return runStatsCommand(parsed.rest, env)
          case 'db':
            return runDbCommand(parsed.rest, env)
          case 'mcp':
            return runMcpCommand(parsed.rest, { cwd, env })
          case 'plugin':
          case 'plug':
            return runPluginCommand(parsed.rest, { cwd, env })
          case 'debug':
            return runDebugCommand(parsed.rest, { cwd, env })
          case 'session':
            return runSessionCommand(parsed.rest, { cwd, env })
          case 'import':
            return runImportCommand(parsed.rest)
          case 'export':
            return runExportCommand(parsed.rest)
          case 'run':
            return runPromptCommand(parsed.rest, { cwd, env, fetch })
          case 'serve':
            return runServeCommand(parsed.rest, { cwd, env, runProcess })
          case 'web':
            return runWebCommand(parsed.rest, { cwd, env, runProcess })
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
  if (normalizedArgv.length === 0) {
    return { command: 'run', rest: ['--interactive', '--demo'] }
  }

  const [first, ...rest] = normalizedArgv
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
  options: { cwd: string; env: SpecterCodeCliEnvironment; fetch?: SpecterCodeFetch },
) {
  const { runSpecterCodePrompt } = await import('./run.ts')
  return runSpecterCodePrompt({ argv, cwd: options.cwd, env: options.env, fetch: options.fetch })
}

async function runServeCommand(
  argv: readonly string[],
  options: ServeCommandOptions,
) {
  return runDevServerCommand(argv, options, {
    commandName: 'serve',
    usage: 'Usage: specter-code serve [--host <host>] [--port <port>]\n',
    open: false,
  })
}

async function runWebCommand(
  argv: readonly string[],
  options: ServeCommandOptions,
) {
  return runDevServerCommand(argv, options, {
    commandName: 'web',
    usage: 'Usage: specter-code web [--host <host>] [--port <port>]\n',
    open: true,
  })
}

async function runDevServerCommand(
  argv: readonly string[],
  options: ServeCommandOptions,
  command: { commandName: string; usage: string; open: boolean },
) {
  const args = ['--filter', '@specter/specter-code', 'dev']
  if (command.open) args.push('--open')

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
      return ok(command.usage)
    }
    return fail(`Unknown ${command.commandName} option: ${arg}\n\n${command.usage}`, 1)
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

async function runCatalogCommand(
  argv: readonly string[],
  command: string,
  render: () => Promise<string>,
) {
  if (argv.length === 0) return ok(await render())
  if (argv.length === 1 && isHelpArg(argv[0])) return ok(`Usage: specter-code ${command}\n`)
  return fail(`Unknown ${command} option: ${argv[0]}\n\nUsage: specter-code ${command}\n`, 1)
}

async function runStatsCommand(argv: readonly string[], env: SpecterCodeCliEnvironment) {
  if (argv.length === 0) return ok(await renderStats(env))
  if (argv.length === 1 && isHelpArg(argv[0])) return ok('Usage: specter-code stats\n')
  return fail(`Unknown stats option: ${argv[0]}\n\nUsage: specter-code stats\n`, 1)
}

async function runDbCommand(argv: readonly string[], env: SpecterCodeCliEnvironment) {
  if (argv.length === 0 || isHelpArg(argv[0])) return ok(DB_USAGE)

  if (argv[0] === 'path') {
    if (argv.length === 1) return ok(`${cliSqlitePath(env)}\n`)
    if (argv.length === 2 && isHelpArg(argv[1])) return ok('Usage: specter-code db path\n')
    return fail(`Unknown db path option: ${argv[1]}\n\nUsage: specter-code db path\n`, 1)
  }

  if (argv[0] === 'query') {
    if (argv.length === 2 && isHelpArg(argv[1])) {
      return ok('Usage: specter-code db query <sql> [--format json|tsv]\n')
    }
    return runDbQueryCommand(argv.slice(1), env)
  }

  return fail(`Unknown db command: ${argv[0]}\n\n${DB_USAGE}`, 1)
}

type DbQueryFormat = 'json' | 'tsv'

async function runDbQueryCommand(argv: readonly string[], env: SpecterCodeCliEnvironment) {
  const parsed = parseDbQueryArgs(argv)
  const sql = parsed.sql.trim()
  if (!isReadonlySelect(sql)) {
    return fail('Only readonly SELECT queries are supported by specter-code db query\n', 1)
  }

  return ok(await renderDbQuery(env, sql, parsed.format))
}

function parseDbQueryArgs(argv: readonly string[]): { sql: string; format: DbQueryFormat } {
  let format: DbQueryFormat = 'tsv'
  const sqlParts: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--format') {
      const value = optionValue(argv, index, '--format')
      if (value !== 'json' && value !== 'tsv') throw new Error('DB query format must be json or tsv')
      format = value
      index += 1
      continue
    }
    if (arg === '--help' || arg === '-h') {
      throw new Error('Usage: specter-code db query <sql> [--format json|tsv]')
    }
    sqlParts.push(arg)
  }

  const sql = sqlParts.join(' ').trim()
  if (!sql) throw new Error('Usage: specter-code db query <sql> [--format json|tsv]')
  return { sql, format }
}

function isReadonlySelect(sql: string) {
  const normalized = sql
    .trim()
    .replace(/^\s*--.*$/gm, '')
    .trim()
    .replace(/;\s*$/, '')
    .trim()
    .toLowerCase()
  if (normalized.includes(';')) return false
  if (normalized.startsWith('select')) return true
  if (!normalized.startsWith('with')) return false
  return /\)\s*select\b/.test(normalized)
}

async function renderDbQuery(
  env: SpecterCodeCliEnvironment,
  sql: string,
  format: DbQueryFormat,
) {
  const [{ createClient }, { prepareSpecterSqlite }] = await Promise.all([
    import('@libsql/client/sqlite3'),
    import('../../../db/specter-sqlite.ts'),
  ])
  const sqlite = createClient({ url: `file:${cliSqlitePath(env)}` })

  try {
    await prepareSpecterSqlite(sqlite)
    const result = await sqlite.execute({ sql, args: [] })
    const rows = result.rows.map((row) => ({ ...row }))
    if (format === 'json') return `${JSON.stringify(rows, null, 2)}\n`
    if (rows.length === 0) return ''

    const columns = result.columns.length > 0 ? result.columns : Object.keys(rows[0] ?? {})
    const lines = [columns.join('\t')]
    for (const row of rows) {
      lines.push(columns.map((column) => formatDbCell(row[column])).join('\t'))
    }
    return `${lines.join('\n')}\n`
  } finally {
    sqlite.close()
  }
}

function formatDbCell(value: unknown) {
  if (value === null || value === undefined) return ''
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64')
  return String(value)
}

function cliSqlitePath(env: SpecterCodeCliEnvironment) {
  return env.SPECTER_CODE_DB_PATH ?? './data/specter-code.db'
}

async function runDebugCommand(
  argv: readonly string[],
  options: { cwd: string; env: SpecterCodeCliEnvironment },
) {
  if (argv.length === 0 || isHelpArg(argv[0])) return ok(DEBUG_USAGE)

  if (argv[0] === 'info') {
    if (argv.length === 1) return ok(await renderDebugInfo(options.cwd, options.env))
    if (argv.length === 2 && isHelpArg(argv[1])) return ok('Usage: specter-code debug info\n')
    return fail(`Unknown debug info option: ${argv[1]}\n\nUsage: specter-code debug info\n`, 1)
  }

  if (argv[0] === 'paths') {
    if (argv.length === 1) return ok(await renderDebugPaths(options.cwd, options.env))
    if (argv.length === 2 && isHelpArg(argv[1])) return ok('Usage: specter-code debug paths\n')
    return fail(`Unknown debug paths option: ${argv[1]}\n\nUsage: specter-code debug paths\n`, 1)
  }

  return fail(`Unknown debug command: ${argv[0]}\n\n${DEBUG_USAGE}`, 1)
}

async function renderDebugInfo(cwd: string, env: SpecterCodeCliEnvironment) {
  const [{ createProviderRegistry }, config] = await Promise.all([
    import('../adapters/llm-provider.ts'),
    loadCliConfig(cwd, env),
  ])
  const registry = createProviderRegistry({ config, env })
  const providers = registry
    .listProviders()
    .slice()
    .sort((left, right) => {
      if (left.configured !== right.configured) return left.configured ? -1 : 1
      return left.id.localeCompare(right.id)
    })
    .map((provider) => `${provider.id}(${provider.configured ? 'configured' : 'missing key'})`)
    .join(', ')

  return [
    'Specter Code debug info',
    `cwd: ${cwd}`,
    `database: ${cliSqlitePath(env)}`,
    `node: ${process.version}`,
    `platform: ${process.platform} ${process.arch}`,
    `config sources: ${formatConfigSources(config.sources)}`,
    `plugins: ${formatPluginList(config.plugin)}`,
    `providers: ${providers || 'none'}`,
  ].join('\n') + '\n'
}

async function renderDebugPaths(cwd: string, env: SpecterCodeCliEnvironment) {
  const { join } = await import('node:path')
  return [
    ['cwd', cwd],
    ['database', cliSqlitePath(env)],
    ['project config', join(cwd, '.opencode', 'opencode.jsonc')],
    ['project config json', join(cwd, '.opencode', 'opencode.json')],
    ['workspace opencode.jsonc', join(cwd, 'opencode.jsonc')],
    ['workspace opencode.json', join(cwd, 'opencode.json')],
  ]
    .map(([name, value]) => `${name}	${value}`)
    .join('\n') + '\n'
}

function formatConfigSources(sources: readonly string[]) {
  return sources.length > 0 ? sources.join(', ') : 'none'
}

function formatPluginList(plugins: readonly (string | [string, Record<string, unknown>])[] | undefined) {
  if (!plugins || plugins.length === 0) return 'none'
  return plugins.map((plugin) => (typeof plugin === 'string' ? plugin : plugin[0])).join(', ')
}

async function renderStats(env: SpecterCodeCliEnvironment) {
  const [{ mkdirSync }, { dirname }, { createClient }, { prepareSpecterSqlite }] =
    await Promise.all([
      import('node:fs'),
      import('node:path'),
      import('@libsql/client/sqlite3'),
      import('../../../db/specter-sqlite.ts'),
    ])
  const sqlitePath = cliSqlitePath(env)

  mkdirSync(dirname(sqlitePath), { recursive: true })
  const sqlite = createClient({ url: `file:${sqlitePath}` })

  try {
    await prepareSpecterSqlite(sqlite)
    const [sessionResult, messageResult, toolResult, permissionResult, topToolResult, topModelResult] =
      await Promise.all([
        sqlite.execute({
          sql: `
            SELECT
              COUNT(*) AS total,
              SUM(CASE WHEN status != 'deleted' THEN 1 ELSE 0 END) AS active
            FROM specter_code_sessions
          `,
          args: [],
        }),
        sqlite.execute({ sql: 'SELECT COUNT(*) AS total FROM specter_code_messages', args: [] }),
        sqlite.execute({ sql: 'SELECT COUNT(*) AS total FROM specter_code_tool_calls', args: [] }),
        sqlite.execute({
          sql: "SELECT COUNT(*) AS total FROM specter_code_permissions WHERE status = 'pending'",
          args: [],
        }),
        sqlite.execute({
          sql: `
            SELECT tool_name, COUNT(*) AS total
            FROM specter_code_tool_calls
            GROUP BY tool_name
            ORDER BY total DESC, tool_name ASC
            LIMIT 5
          `,
          args: [],
        }),
        sqlite.execute({
          sql: `
            SELECT provider_id, model_id, COUNT(*) AS total
            FROM specter_code_sessions
            WHERE status != 'deleted'
            GROUP BY provider_id, model_id
            ORDER BY total DESC, provider_id ASC, model_id ASC
            LIMIT 5
          `,
          args: [],
        }),
      ])

    const totalSessions = numberCell(sessionResult.rows[0]?.total)
    const activeSessions = numberCell(sessionResult.rows[0]?.active)
    const totalMessages = numberCell(messageResult.rows[0]?.total)
    const totalToolCalls = numberCell(toolResult.rows[0]?.total)
    const pendingApprovals = numberCell(permissionResult.rows[0]?.total)
    const topTools = formatNameCounts(
      topToolResult.rows.map((row) => ({
        name: String(row.tool_name),
        total: numberCell(row.total),
      })),
    )
    const topModels = formatNameCounts(
      topModelResult.rows.map((row) => ({
        name: `${String(row.provider_id)}/${String(row.model_id)}`,
        total: numberCell(row.total),
      })),
    )

    return [
      'Specter Code stats',
      `Database: ${sqlitePath}`,
      `Sessions: ${activeSessions} active / ${totalSessions} total`,
      `Messages: ${totalMessages}`,
      `Tool calls: ${totalToolCalls}`,
      `Pending approvals: ${pendingApprovals}`,
      `Top tools: ${topTools}`,
      `Top models: ${topModels}`,
    ].join('\n') + '\n'
  } finally {
    sqlite.close()
  }
}

function numberCell(value: unknown) {
  const numberValue = Number(value ?? 0)
  return Number.isFinite(numberValue) ? numberValue : 0
}

function formatNameCounts(entries: Array<{ name: string; total: number }>) {
  if (entries.length === 0) return '-'
  return entries.map((entry) => `${entry.name}=${entry.total}`).join(', ')
}

async function runMcpCommand(
  argv: readonly string[],
  options: { cwd: string; env: SpecterCodeCliEnvironment },
) {
  if ((argv[0] === 'list' && argv.length === 1) || argv[0] === undefined) {
    return ok(await renderMcpServers(options.cwd, options.env))
  }
  if (isHelpArg(argv[0]) || (argv[0] === 'list' && isHelpArg(argv[1]))) {
    return ok('Usage: specter-code mcp list\n')
  }
  return fail(`Unknown mcp command: ${argv[0]}\n\nUsage: specter-code mcp list\n`, 1)
}

async function renderMcpServers(cwd: string, env: SpecterCodeCliEnvironment) {
  const config = await loadCliConfig(cwd, env)
  const entries = Object.entries(config.mcp ?? {})
  if (entries.length === 0) return 'No MCP servers configured\n'

  const lines = entries.map(([name, value]) => {
    const server = isRecord(value) ? value : {}
    const type = typeof server.type === 'string' ? server.type : 'local'
    const status = server.enabled === false ? 'disabled' : 'enabled'
    return `${name}\t${type}\t${status}\t${mcpServerTarget(server)}`
  })
  return `${lines.join('\n')}\n`
}

function mcpServerTarget(server: Record<string, unknown>) {
  if (Array.isArray(server.command)) {
    return server.command.map((part) => String(part)).join(' ')
  }
  if (typeof server.command === 'string') return server.command
  if (typeof server.url === 'string') return server.url
  return '-'
}

const PLUGIN_USAGE = 'Usage: specter-code plugin <module> [--global] [--force]\n'

async function runPluginCommand(
  argv: readonly string[],
  options: { cwd: string; env: SpecterCodeCliEnvironment },
) {
  if (argv.length === 0 || isHelpArg(argv[0])) return ok(PLUGIN_USAGE)

  const parsed = parsePluginArgs(argv)
  const result = await registerPluginModule({
    module: parsed.module,
    global: parsed.global,
    force: parsed.force,
    cwd: options.cwd,
    env: options.env,
  })
  const verb = result.alreadyConfigured ? 'Plugin already configured' : 'Registered plugin'
  return ok(`${verb} ${parsed.module} in ${result.configPath}\n`)
}

function parsePluginArgs(argv: readonly string[]) {
  let moduleName: string | undefined
  let global = false
  let force = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--global' || arg === '-g') {
      global = true
      continue
    }
    if (arg === '--force' || arg === '-f') {
      force = true
      continue
    }
    if (isHelpArg(arg)) throw new Error(PLUGIN_USAGE.trimEnd())
    if (!moduleName && !arg.startsWith('--')) {
      moduleName = arg
      continue
    }
    throw new Error(PLUGIN_USAGE.trimEnd())
  }

  const normalizedModule = moduleName?.trim()
  if (!normalizedModule) throw new Error(PLUGIN_USAGE.trimEnd())
  return { module: normalizedModule, global, force }
}

type RegisterPluginInput = {
  module: string
  global: boolean
  force: boolean
  cwd: string
  env: SpecterCodeCliEnvironment
}

async function registerPluginModule(input: RegisterPluginInput) {
  const [{ mkdir, readFile, writeFile }, { dirname, join }] = await Promise.all([
    import('node:fs/promises'),
    import('node:path'),
  ])
  const configPath = input.global
    ? join(input.env.OPENCODE_CONFIG_DIR ?? join(input.env.HOME ?? input.cwd, '.config', 'opencode'), 'opencode.jsonc')
    : join(input.cwd, '.opencode', 'opencode.jsonc')

  let config: Record<string, unknown> = {}
  try {
    const text = await readFile(configPath, 'utf8')
    config = parseCliJsonc(text, configPath)
  } catch (error) {
    if (!isNodeErrorCode(error, 'ENOENT')) throw error
  }

  const existing = Array.isArray(config.plugin)
    ? config.plugin.filter((item): item is string => typeof item === 'string')
    : []
  const alreadyConfigured = existing.includes(input.module)
  const nextPlugins = input.force
    ? [...existing.filter((item) => item !== input.module), input.module]
    : alreadyConfigured
      ? existing
      : [...existing, input.module]

  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, `${JSON.stringify({ ...config, plugin: nextPlugins }, null, 2)}\n`)
  return { configPath, alreadyConfigured }
}

function parseCliJsonc(text: string, source: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(stripCliJsonComments(text).replace(/,\s*([}\]])/g, '$1'))
    if (!isRecord(parsed)) throw new Error('Config root must be an object')
    return parsed
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to parse OpenCode config ${source}: ${message}`)
  }
}

function stripCliJsonComments(text: string) {
  let output = ''
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? ''
    const next = text[index + 1] ?? ''
    if (inString) {
      output += character
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }
    if (character === '"') {
      inString = true
      output += character
      continue
    }
    if (character === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') index += 1
      output += '\n'
      continue
    }
    if (character === '/' && next === '*') {
      index += 2
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index += 1
      index += 1
      continue
    }
    output += character
  }
  return output
}

function isNodeErrorCode(error: unknown, code: string) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code)
}

function isHelpArg(value: string | undefined) {
  return value === '--help' || value === '-h'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function runSessionCommand(
  argv: readonly string[],
  options: { cwd: string; env: SpecterCodeCliEnvironment },
) {
  if (argv[0] === '--help' || argv[0] === '-h' || argv[0] === undefined) {
    return ok(SESSION_USAGE)
  }
  if (argv[0] === 'list' && argv.length === 1) {
    return ok(await renderSessionList(options.env))
  }
  if (argv[0] === 'list' && (argv[1] === '--help' || argv[1] === '-h')) {
    return ok('Usage: specter-code session list\n')
  }
  if (argv[0] === 'show' && (argv[1] === '--help' || argv[1] === '-h')) {
    return ok('Usage: specter-code session show <id>\n')
  }
  if (argv[0] === 'show' && argv[1] && argv.length === 2) {
    return ok(await renderSessionDetail(argv[1], options.env))
  }
  if (argv[0] === 'new') {
    return runSessionNewCommand(argv.slice(1), options)
  }
  if (argv[0] === 'rename') {
    return runSessionRenameCommand(argv.slice(1), options)
  }
  if (argv[0] === 'delete' || argv[0] === 'rm') {
    return runSessionDeleteCommand(argv.slice(1), options)
  }

  return fail(`Unknown session command: ${argv[0] ?? ''}\n\n${SESSION_USAGE}`, 1)
}

type SessionCreateInput = {
  sessionId?: string
  workspaceId: string
  title: string
  directory: string
  agent: string
  model: { providerId: string; modelId: string }
  createdBy: { displayName: string }
}

async function runSessionNewCommand(
  argv: readonly string[],
  options: { cwd: string; env: SpecterCodeCliEnvironment },
) {
  if (argv.includes('--help') || argv.includes('-h')) {
    return ok(
      'Usage: specter-code session new --title <title> [--id <id>] [--workspace <id>] [--directory <path>] [--agent <agent>] [--model <provider/model>]\n',
    )
  }

  const config = await loadCliConfig(options.cwd, options.env)
  const defaults = {
    workspaceId: 'default',
    directory: options.cwd,
    agent: config.defaultAgent ?? 'build',
    model: config.model ?? { providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4' },
  }
  const parsed = parseSessionNewOptions(argv, defaults)
  const sessionId = parsed.sessionId ?? crypto.randomUUID()

  await createCliSession(options.env, {
    sessionId,
    workspaceId: parsed.workspaceId,
    title: parsed.title,
    directory: parsed.directory,
    agent: parsed.agent,
    model: parsed.model,
    createdBy: { displayName: 'Specter Code CLI' },
  })

  return ok(
    `Created session ${sessionId}\t${parsed.title}\t${parsed.agent}\t${parsed.model.providerId}/${parsed.model.modelId}\t${parsed.directory}\n`,
  )
}

function parseSessionNewOptions(
  argv: readonly string[],
  defaults: Omit<SessionCreateInput, 'title' | 'createdBy'>,
): Omit<SessionCreateInput, 'createdBy'> {
  let sessionId: string | undefined
  let workspaceId = defaults.workspaceId
  let title: string | undefined
  let directory = defaults.directory
  let agent = defaults.agent
  let model = defaults.model

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--id') {
      sessionId = optionValue(argv, index, '--id')
      index += 1
      continue
    }
    if (arg === '--workspace') {
      workspaceId = optionValue(argv, index, '--workspace')
      index += 1
      continue
    }
    if (arg === '--title') {
      title = optionValue(argv, index, '--title')
      index += 1
      continue
    }
    if (arg === '--directory' || arg === '--cwd') {
      directory = optionValue(argv, index, arg)
      index += 1
      continue
    }
    if (arg === '--agent') {
      agent = optionValue(argv, index, '--agent')
      index += 1
      continue
    }
    if (arg === '--model') {
      model = parseCliModelRef(optionValue(argv, index, '--model'))
      index += 1
      continue
    }
    return failWithUsage(`Unknown session new option: ${arg}`)
  }

  const normalizedTitle = title?.trim()
  if (!normalizedTitle) return failWithUsage('Session title is required')
  const normalizedWorkspaceId = workspaceId.trim()
  if (!normalizedWorkspaceId) return failWithUsage('Workspace id is required')
  const normalizedAgent = agent.trim()
  if (!normalizedAgent) return failWithUsage('Agent is required')
  const normalizedDirectory = directory.trim()
  if (!normalizedDirectory) return failWithUsage('Directory is required')

  return {
    sessionId: sessionId?.trim() || undefined,
    workspaceId: normalizedWorkspaceId,
    title: normalizedTitle,
    directory: normalizedDirectory,
    agent: normalizedAgent,
    model,
  }
}

function parseCliModelRef(value: string) {
  const slash = value.indexOf('/')
  if (slash <= 0 || slash === value.length - 1) {
    throw new Error('Model must use provider/model syntax')
  }
  return { providerId: value.slice(0, slash), modelId: value.slice(slash + 1) }
}

function failWithUsage(message: string): never {
  throw new Error(
    `${message}\n\nUsage: specter-code session new --title <title> [--id <id>] [--workspace <id>] [--directory <path>] [--agent <agent>] [--model <provider/model>]`,
  )
}


async function runSessionRenameCommand(
  argv: readonly string[],
  options: { env: SpecterCodeCliEnvironment },
) {
  if (argv.includes('--help') || argv.includes('-h')) {
    return ok('Usage: specter-code session rename <id> <title>\n')
  }

  const sessionId = argv[0]?.trim()
  const title = argv.slice(1).join(' ').trim()
  if (!sessionId || !title) {
    return fail('Usage: specter-code session rename <id> <title>\n', 1)
  }

  await renameCliSession(options.env, {
    sessionId,
    title,
    updatedBy: { displayName: 'Specter Code CLI' },
  })

  return ok(`Renamed session ${sessionId}\t${title}\n`)
}


async function runSessionDeleteCommand(
  argv: readonly string[],
  options: { env: SpecterCodeCliEnvironment },
) {
  if (argv.includes('--help') || argv.includes('-h')) {
    return ok('Usage: specter-code session delete <id>\n')
  }

  const sessionId = argv[0]?.trim()
  if (!sessionId || argv.length !== 1) {
    return fail('Usage: specter-code session delete <id>\n', 1)
  }

  await deleteCliSession(options.env, {
    sessionId,
    deletedBy: { displayName: 'Specter Code CLI' },
  })

  return ok(`Deleted session ${sessionId}\n`)
}

async function createCliSession(
  env: SpecterCodeCliEnvironment,
  input: SessionCreateInput & { sessionId: string },
) {
  const [
    { mkdirSync },
    { dirname },
    { createClient },
    { prepareSpecterSqlite },
    { sessionCreatedEvent },
    { projectSpecterCodeEvent },
  ] = await Promise.all([
    import('node:fs'),
    import('node:path'),
    import('@libsql/client/sqlite3'),
    import('../../../db/specter-sqlite.ts'),
    import('../events.ts'),
    import('../adapters/read-models.ts'),
  ])
  const sqlitePath = env.SPECTER_CODE_DB_PATH ?? './data/specter-code.db'

  mkdirSync(dirname(sqlitePath), { recursive: true })
  const sqlite = createClient({ url: `file:${sqlitePath}` })

  try {
    await prepareSpecterSqlite(sqlite)
    const eventDraft = sessionCreatedEvent.create({
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      title: input.title,
      directory: input.directory,
      agent: input.agent,
      model: input.model,
      createdBy: input.createdBy,
    })
    const eventId = crypto.randomUUID()
    const recordedAt = new Date().toISOString()

    await sqlite.execute({
      sql: `
        INSERT INTO specter_events (id, type, payload, recorded_at)
        VALUES (?, ?, ?, ?)
      `,
      args: [eventId, eventDraft.type, JSON.stringify(eventDraft.payload), recordedAt],
    })
    const orderResult = await sqlite.execute({
      sql: 'SELECT event_order FROM specter_events WHERE id = ?',
      args: [eventId],
    })
    const order = Number(orderResult.rows[0]?.event_order)
    if (!Number.isFinite(order)) throw new Error('Failed to persist session event')

    await projectSpecterCodeEvent(sqlite, {
      id: eventId,
      order,
      type: eventDraft.type,
      payload: eventDraft.payload,
      recordedAt,
    })
  } finally {
    sqlite.close()
  }
}

async function renameCliSession(
  env: SpecterCodeCliEnvironment,
  input: {
    sessionId: string
    title: string
    updatedBy: { displayName: string }
  },
) {
  const [
    { mkdirSync },
    { dirname },
    { createClient },
    { prepareSpecterSqlite },
    { sessionUpdatedEvent },
    { projectSpecterCodeEvent },
  ] = await Promise.all([
    import('node:fs'),
    import('node:path'),
    import('@libsql/client/sqlite3'),
    import('../../../db/specter-sqlite.ts'),
    import('../events.ts'),
    import('../adapters/read-models.ts'),
  ])
  const sqlitePath = env.SPECTER_CODE_DB_PATH ?? './data/specter-code.db'

  mkdirSync(dirname(sqlitePath), { recursive: true })
  const sqlite = createClient({ url: `file:${sqlitePath}` })

  try {
    await prepareSpecterSqlite(sqlite)
    const existing = await sqlite.execute({
      sql: "SELECT id FROM specter_code_sessions WHERE id = ? AND status != 'deleted' LIMIT 1",
      args: [input.sessionId],
    })
    if (!existing.rows[0]) throw new Error(`Session not found: ${input.sessionId}`)

    const eventDraft = sessionUpdatedEvent.create({
      sessionId: input.sessionId,
      title: input.title,
      updatedBy: input.updatedBy,
    })
    const eventId = crypto.randomUUID()
    const recordedAt = new Date().toISOString()

    await sqlite.execute({
      sql: `
        INSERT INTO specter_events (id, type, payload, recorded_at)
        VALUES (?, ?, ?, ?)
      `,
      args: [eventId, eventDraft.type, JSON.stringify(eventDraft.payload), recordedAt],
    })
    const orderResult = await sqlite.execute({
      sql: 'SELECT event_order FROM specter_events WHERE id = ?',
      args: [eventId],
    })
    const order = Number(orderResult.rows[0]?.event_order)
    if (!Number.isFinite(order)) throw new Error('Failed to persist session event')

    await projectSpecterCodeEvent(sqlite, {
      id: eventId,
      order,
      type: eventDraft.type,
      payload: eventDraft.payload,
      recordedAt,
    })
  } finally {
    sqlite.close()
  }
}


async function deleteCliSession(
  env: SpecterCodeCliEnvironment,
  input: {
    sessionId: string
    deletedBy: { displayName: string }
  },
) {
  const [
    { mkdirSync },
    { dirname },
    { createClient },
    { prepareSpecterSqlite },
    { sessionDeletedEvent },
    { projectSpecterCodeEvent },
  ] = await Promise.all([
    import('node:fs'),
    import('node:path'),
    import('@libsql/client/sqlite3'),
    import('../../../db/specter-sqlite.ts'),
    import('../events.ts'),
    import('../adapters/read-models.ts'),
  ])
  const sqlitePath = env.SPECTER_CODE_DB_PATH ?? './data/specter-code.db'

  mkdirSync(dirname(sqlitePath), { recursive: true })
  const sqlite = createClient({ url: `file:${sqlitePath}` })

  try {
    await prepareSpecterSqlite(sqlite)
    const existing = await sqlite.execute({
      sql: "SELECT id FROM specter_code_sessions WHERE id = ? AND status != 'deleted' LIMIT 1",
      args: [input.sessionId],
    })
    if (!existing.rows[0]) throw new Error(`Session not found: ${input.sessionId}`)

    const eventDraft = sessionDeletedEvent.create({
      sessionId: input.sessionId,
      deletedBy: input.deletedBy,
    })
    const eventId = crypto.randomUUID()
    const recordedAt = new Date().toISOString()

    await sqlite.execute({
      sql: `
        INSERT INTO specter_events (id, type, payload, recorded_at)
        VALUES (?, ?, ?, ?)
      `,
      args: [eventId, eventDraft.type, JSON.stringify(eventDraft.payload), recordedAt],
    })
    const orderResult = await sqlite.execute({
      sql: 'SELECT event_order FROM specter_events WHERE id = ?',
      args: [eventId],
    })
    const order = Number(orderResult.rows[0]?.event_order)
    if (!Number.isFinite(order)) throw new Error('Failed to persist session event')

    await projectSpecterCodeEvent(sqlite, {
      id: eventId,
      order,
      type: eventDraft.type,
      payload: eventDraft.payload,
      recordedAt,
    })
  } finally {
    sqlite.close()
  }
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

type AuthCredential =
  | { type: 'api'; key: string; metadata?: Record<string, string> }
  | { type: 'oauth'; refresh?: string; access?: string; expires?: number }

type AuthAccount = {
  id: string
  serviceID: string
  description: string
  credential: AuthCredential
}

type AuthFile = {
  version: 2
  accounts: Record<string, AuthAccount>
  active: Record<string, string>
}

async function runAuthCommand(
  argv: readonly string[],
  env: SpecterCodeCliEnvironment,
): Promise<SpecterCodeCliResult> {
  if (argv.length === 0 || isHelpArg(argv[0])) return ok(AUTH_USAGE)

  const [subcommand, ...rest] = argv
  if (subcommand === 'login') return authLogin(rest, env)
  if (subcommand === 'list') return authList(rest, env)
  if (subcommand === 'logout') return authLogout(rest, env)
  return fail(`Unknown auth command: ${subcommand}\n\n${AUTH_USAGE}`, 1)
}

async function authLogin(
  argv: readonly string[],
  env: SpecterCodeCliEnvironment,
): Promise<SpecterCodeCliResult> {
  if (argv.length === 1 && isHelpArg(argv[0])) {
    return ok('Usage: specter-code auth login --provider <id> --key <api-key> [--description <label>]\n')
  }

  let providerId: string | undefined
  let key: string | undefined
  let description: string | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--provider' || arg === '--provider-id' || arg === '--service') {
      providerId = optionValue(argv, index, arg)
      index += 1
      continue
    }
    if (arg === '--key' || arg === '--api-key') {
      key = optionValue(argv, index, arg)
      index += 1
      continue
    }
    if (arg === '--description' || arg === '--label') {
      description = optionValue(argv, index, arg)
      index += 1
      continue
    }
    return fail('Usage: specter-code auth login --provider <id> --key <api-key> [--description <label>]\n', 1)
  }

  if (!providerId || !key) {
    return fail('Usage: specter-code auth login --provider <id> --key <api-key> [--description <label>]\n', 1)
  }

  const label = description ?? 'default'
  const file = await loadAuthFile(env)
  const accountId = `${sanitizeAuthAccountId(providerId)}-default`
  const account: AuthAccount = {
    id: accountId,
    serviceID: providerId,
    description: label,
    credential: { type: 'api', key },
  }
  file.accounts = Object.fromEntries(
    Object.entries(file.accounts).filter(
      ([id, existing]) => id === accountId || existing.serviceID !== providerId,
    ),
  )
  file.accounts[accountId] = account
  file.active[providerId] = accountId
  await writeAuthFile(env, file)
  return ok(`Authenticated ${providerId} as ${label}\n`)
}

async function authList(
  argv: readonly string[],
  env: SpecterCodeCliEnvironment,
): Promise<SpecterCodeCliResult> {
  if (argv.length === 1 && isHelpArg(argv[0])) return ok('Usage: specter-code auth list\n')
  if (argv.length > 0) return fail('Usage: specter-code auth list\n', 1)

  const file = await loadAuthFile(env)
  const accounts = Object.values(file.accounts).sort((left, right) =>
    left.serviceID.localeCompare(right.serviceID) || left.description.localeCompare(right.description),
  )
  if (accounts.length === 0) return ok('No authenticated providers\n')

  const lines = accounts.map((account) => {
    const status = file.active[account.serviceID] === account.id ? 'active' : '-'
    return `${account.serviceID}\t${account.description}\t${account.credential.type}\t${status}`
  })
  return ok(`${lines.join('\n')}\n`)
}

async function authLogout(
  argv: readonly string[],
  env: SpecterCodeCliEnvironment,
): Promise<SpecterCodeCliResult> {
  if (argv.length === 1 && isHelpArg(argv[0])) return ok('Usage: specter-code auth logout <provider>\n')
  if (argv.length !== 1 || argv[0].startsWith('--')) {
    return fail('Usage: specter-code auth logout <provider>\n', 1)
  }

  const providerId = argv[0]
  const file = await loadAuthFile(env)
  file.accounts = Object.fromEntries(
    Object.entries(file.accounts).filter(
      ([accountId, account]) => accountId !== providerId && account.serviceID !== providerId,
    ),
  )
  delete file.active[providerId]
  for (const [serviceID, accountId] of Object.entries(file.active)) {
    if (!file.accounts[accountId]) delete file.active[serviceID]
  }
  await writeAuthFile(env, file)
  return ok(`Logged out ${providerId}\n`)
}

async function loadAuthFile(env: SpecterCodeCliEnvironment): Promise<AuthFile> {
  const content = env.OPENCODE_AUTH_CONTENT
  if (content) return normalizeAuthFile(JSON.parse(content))

  const [{ readFile }] = await Promise.all([import('node:fs/promises')])
  try {
    return normalizeAuthFile(JSON.parse(await readFile(await authFilePath(env), 'utf8')))
  } catch (error) {
    if (isMissingFileError(error)) return { version: 2, accounts: {}, active: {} }
    throw error
  }
}

async function writeAuthFile(env: SpecterCodeCliEnvironment, file: AuthFile) {
  const [{ mkdir, writeFile }, { dirname }] = await Promise.all([
    import('node:fs/promises'),
    import('node:path'),
  ])
  const filePath = await authFilePath(env)
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 })
}

async function authFilePath(env: SpecterCodeCliEnvironment) {
  if (env.SPECTER_CODE_AUTH_PATH) return env.SPECTER_CODE_AUTH_PATH
  if (env.OPENCODE_AUTH_PATH) return env.OPENCODE_AUTH_PATH
  const [{ join }, { homedir }] = await Promise.all([import('node:path'), import('node:os')])
  const dataHome = env.XDG_DATA_HOME ?? join(env.HOME ?? homedir(), '.local', 'share')
  return join(dataHome, 'opencode', 'auth-v2.json')
}

function normalizeAuthFile(value: unknown): AuthFile {
  if (!isRecord(value)) return { version: 2, accounts: {}, active: {} }
  if (value.version === 2) {
    return {
      version: 2,
      accounts: normalizeAuthAccounts(value.accounts),
      active: normalizeAuthActive(value.active),
    }
  }
  return migrateLegacyAuthFile(value)
}

function normalizeAuthAccounts(value: unknown): Record<string, AuthAccount> {
  if (!isRecord(value)) return {}
  const accounts: Record<string, AuthAccount> = {}
  for (const [id, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue
    const serviceID = typeof raw.serviceID === 'string' ? raw.serviceID : undefined
    const credential = normalizeAuthCredential(raw.credential)
    if (!serviceID || !credential) continue
    accounts[id] = {
      id: typeof raw.id === 'string' ? raw.id : id,
      serviceID,
      description: typeof raw.description === 'string' ? raw.description : 'default',
      credential,
    }
  }
  return accounts
}

function normalizeAuthActive(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

function normalizeAuthCredential(value: unknown): AuthCredential | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') return undefined
  if (value.type === 'api' && typeof value.key === 'string') return { type: 'api', key: value.key }
  if (value.type === 'oauth') {
    const credential: AuthCredential = { type: 'oauth' }
    if (typeof value.refresh === 'string') credential.refresh = value.refresh
    if (typeof value.access === 'string') credential.access = value.access
    if (typeof value.expires === 'number') credential.expires = value.expires
    return credential
  }
  return undefined
}

function migrateLegacyAuthFile(value: Record<string, unknown>): AuthFile {
  const migrated: AuthFile = { version: 2, accounts: {}, active: {} }
  for (const [providerId, credentialValue] of Object.entries(value)) {
    const credential = normalizeAuthCredential(credentialValue)
    if (!credential) continue
    const accountId = `${sanitizeAuthAccountId(providerId)}-default`
    migrated.accounts[accountId] = {
      id: accountId,
      serviceID: providerId,
      description: 'default',
      credential,
    }
    migrated.active[providerId] = accountId
  }
  return migrated
}

function sanitizeAuthAccountId(providerId: string) {
  return providerId.replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'provider'
}

function isMissingFileError(error: unknown) {
  return isRecord(error) && error.code === 'ENOENT'
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
