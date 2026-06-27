import { access, readFile } from 'node:fs/promises'
import path from 'node:path'

import type { PermissionAction, PermissionRule } from './permissions.ts'

export type SpecterCodeModelConfig = {
  providerId: string
  modelId: string
}

export type SpecterCodePluginEntry = string | [string, Record<string, unknown>]

export type SpecterCodeConfig = {
  sources: string[]
  permissionRules: PermissionRule[]
  shell?: string
  model?: SpecterCodeModelConfig
  defaultAgent?: string
  provider?: Record<string, unknown>
  agent?: Record<string, unknown>
  plugin?: SpecterCodePluginEntry[]
  skills?: string[]
  mcp?: Record<string, unknown>
  watcher?: Record<string, unknown>
  formatter?: unknown
  lsp?: unknown
  raw: Record<string, unknown>
}

export type LoadSpecterCodeConfigOptions = {
  workspaceRoot: string
  globalConfigDir?: string
  env?: Pick<NodeJS.ProcessEnv, 'OPENCODE_CONFIG_CONTENT'>
}

type JsonObject = Record<string, unknown>

const PERMISSION_NAME_MAP: Record<string, string> = {
  read: 'file.read',
  glob: 'file.read',
  grep: 'file.read',
  list: 'file.read',
  edit: 'file.write',
  write: 'file.write',
  bash: 'shell.execute',
  shell: 'shell.execute',
  lsp: 'lsp.query',
  question: 'question.ask',
  todowrite: 'todo.write',
  todo: 'todo.write',
  webfetch: 'web.fetch',
  websearch: 'web.search',
  repo_clone: 'repo.clone',
  repo_overview: 'repo.overview',
  skill: 'skill.use',
  task: 'task.spawn',
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function exists(filePath: string) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function stripJsonComments(input: string) {
  let output = ''
  let inString = false
  let quote = ''
  let escaped = false

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    const next = input[index + 1]

    if (inString) {
      output += character
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === quote) {
        inString = false
        quote = ''
      }
      continue
    }

    if (character === '"' || character === "'") {
      inString = true
      quote = character
      output += character
      continue
    }

    if (character === '/' && next === '/') {
      while (index < input.length && input[index] !== '\n') index += 1
      output += '\n'
      continue
    }

    if (character === '/' && next === '*') {
      index += 2
      while (index < input.length && !(input[index] === '*' && input[index + 1] === '/')) {
        if (input[index] === '\n') output += '\n'
        index += 1
      }
      index += 1
      continue
    }

    output += character
  }

  return output
}

function parseJsonc(text: string, source: string): JsonObject {
  const withoutComments = stripJsonComments(text).replace(/,\s*([}\]])/g, '$1')
  try {
    const parsed = JSON.parse(withoutComments)
    if (!isRecord(parsed)) throw new Error('Config root must be an object')
    return parsed
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to parse OpenCode config ${source}: ${message}`)
  }
}

function deepMerge(left: unknown, right: unknown): unknown {
  if (!isRecord(left) || !isRecord(right)) return right

  const result: JsonObject = { ...left }
  for (const [key, value] of Object.entries(right)) {
    result[key] = key in result ? deepMerge(result[key], value) : value
  }
  return result
}

function parseModel(model: unknown): SpecterCodeModelConfig | undefined {
  if (typeof model !== 'string') return undefined
  const slash = model.indexOf('/')
  if (slash <= 0 || slash === model.length - 1) return undefined
  return {
    providerId: model.slice(0, slash),
    modelId: model.slice(slash + 1),
  }
}

function isPermissionAction(value: unknown): value is PermissionAction {
  return value === 'allow' || value === 'ask' || value === 'deny'
}

function permissionNameForOpenCodeKey(key: string) {
  return PERMISSION_NAME_MAP[key] ?? key.replaceAll('_', '.')
}

function permissionRulesFromConfig(permission: unknown): PermissionRule[] {
  if (isPermissionAction(permission)) {
    return [{ permission: '*', pattern: '*', action: permission }]
  }
  if (!isRecord(permission)) return []

  const rules: PermissionRule[] = []
  for (const [key, value] of Object.entries(permission)) {
    const permissionName = permissionNameForOpenCodeKey(key)
    if (isPermissionAction(value)) {
      rules.push({ permission: permissionName, pattern: '*', action: value })
      continue
    }
    if (!isRecord(value)) continue
    for (const [pattern, action] of Object.entries(value)) {
      if (isPermissionAction(action)) {
        rules.push({ permission: permissionName, pattern, action })
      }
    }
  }
  return rules
}

function normalizeRelativePathValue(item: string, sourceDir: string | undefined) {
  if (path.isAbsolute(item)) return path.normalize(item)
  if (!sourceDir || !item.startsWith('.')) return item
  return path.resolve(sourceDir, item)
}

function normalizePathList(value: unknown, sourcePath: string) {
  if (!Array.isArray(value)) return value
  const sourceDir = sourcePath === 'OPENCODE_CONFIG_CONTENT' ? undefined : path.dirname(sourcePath)
  return value.map((item) => {
    if (typeof item !== 'string') return item
    return normalizeRelativePathValue(item, sourceDir)
  })
}

function normalizePluginList(value: unknown, sourcePath: string) {
  if (!Array.isArray(value)) return value
  const sourceDir = sourcePath === 'OPENCODE_CONFIG_CONTENT' ? undefined : path.dirname(sourcePath)
  return value.map((item) => {
    if (typeof item === 'string') return normalizeRelativePathValue(item, sourceDir)
    if (!Array.isArray(item) || typeof item[0] !== 'string' || !isRecord(item[1])) return item
    return [normalizeRelativePathValue(item[0], sourceDir), item[1]]
  })
}

function isPluginEntry(value: unknown): value is SpecterCodePluginEntry {
  if (typeof value === 'string') return true
  return Array.isArray(value) && typeof value[0] === 'string' && isRecord(value[1])
}

function normalizeSourceConfig(config: JsonObject, sourcePath: string): JsonObject {
  return {
    ...config,
    plugin: normalizePluginList(config.plugin, sourcePath),
    skills: normalizePathList(config.skills, sourcePath),
  }
}

function candidateFiles(options: LoadSpecterCodeConfigOptions) {
  const candidates: string[] = []
  if (options.globalConfigDir) {
    candidates.push(
      path.join(options.globalConfigDir, 'config.json'),
      path.join(options.globalConfigDir, 'opencode.json'),
      path.join(options.globalConfigDir, 'opencode.jsonc'),
    )
  }
  candidates.push(
    path.join(options.workspaceRoot, 'opencode.json'),
    path.join(options.workspaceRoot, 'opencode.jsonc'),
    path.join(options.workspaceRoot, '.opencode', 'opencode.json'),
    path.join(options.workspaceRoot, '.opencode', 'opencode.jsonc'),
  )
  return candidates
}

function toSpecterCodeConfig(raw: JsonObject, sources: string[], permissionRules: PermissionRule[]): SpecterCodeConfig {
  return {
    sources,
    permissionRules,
    shell: typeof raw.shell === 'string' ? raw.shell : undefined,
    model: parseModel(raw.model),
    defaultAgent: typeof raw.default_agent === 'string' ? raw.default_agent : undefined,
    provider: isRecord(raw.provider) ? raw.provider : undefined,
    agent: isRecord(raw.agent) ? raw.agent : undefined,
    plugin: Array.isArray(raw.plugin) ? raw.plugin.filter(isPluginEntry) : undefined,
    skills: Array.isArray(raw.skills) ? raw.skills.filter((item): item is string => typeof item === 'string') : undefined,
    mcp: isRecord(raw.mcp) ? raw.mcp : undefined,
    watcher: isRecord(raw.watcher) ? raw.watcher : undefined,
    formatter: raw.formatter,
    lsp: raw.lsp,
    raw,
  }
}

export async function loadSpecterCodeConfig(options: LoadSpecterCodeConfigOptions): Promise<SpecterCodeConfig> {
  let raw: JsonObject = {}
  const sources: string[] = []
  const permissionRules: PermissionRule[] = []

  for (const filePath of candidateFiles(options)) {
    if (!(await exists(filePath))) continue
    const parsed = normalizeSourceConfig(parseJsonc(await readFile(filePath, 'utf8'), filePath), filePath)
    raw = deepMerge(raw, parsed) as JsonObject
    permissionRules.push(...permissionRulesFromConfig(parsed.permission))
    sources.push(filePath)
  }

  const envContent = options.env?.OPENCODE_CONFIG_CONTENT ?? process.env.OPENCODE_CONFIG_CONTENT
  if (envContent) {
    const parsed = normalizeSourceConfig(parseJsonc(envContent, 'OPENCODE_CONFIG_CONTENT'), 'OPENCODE_CONFIG_CONTENT')
    raw = deepMerge(raw, parsed) as JsonObject
    permissionRules.push(...permissionRulesFromConfig(parsed.permission))
    sources.push('OPENCODE_CONFIG_CONTENT')
  }

  return toSpecterCodeConfig(raw, sources, permissionRules)
}
