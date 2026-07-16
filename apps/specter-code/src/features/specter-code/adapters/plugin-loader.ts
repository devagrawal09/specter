import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type {
  SpecterCodeConfig,
  SpecterCodePluginEntry,
} from './config-loader.ts'
import type {
  ToolContext,
  ToolDefinition,
  ToolRegistry,
} from './tool-registry.ts'

export type ToolExtensionLoadResult = {
  kind: 'custom-tool' | 'plugin-tool'
  name: string
  source: string
}

export type LoadOpenCodeToolExtensionsOptions = {
  registry: ToolRegistry
  workspaceRoot: string
  globalConfigDir?: string
  config?: Pick<SpecterCodeConfig, 'plugin'>
  moduleLoader?: (filePath: string) => Promise<Record<string, unknown>>
}

type OpenCodeToolContext = {
  agent: string
  sessionID: string
  messageID: string
  directory: string
  worktree: string
  abortSignal?: AbortSignal
  specter: ToolContext
}

type OpenCodeToolShape = {
  description?: string
  execute: (
    input: unknown,
    context: OpenCodeToolContext,
  ) => unknown | Promise<unknown>
}

type OpenCodePluginInput = {
  directory: string
  worktree: string
  project: { directory: string }
  client: Record<string, never>
}

type OpenCodePluginOptions = Record<string, unknown>

type OpenCodeV1ServerPlugin = {
  server: (
    input: OpenCodePluginInput,
    options?: OpenCodePluginOptions,
  ) => unknown | Promise<unknown>
}

type PluginFileSpec = {
  filePath: string
  options?: OpenCodePluginOptions
}

const TOOL_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isLoadableModuleFile(filePath: string) {
  if (filePath.endsWith('.d.ts')) return false
  return TOOL_EXTENSIONS.has(path.extname(filePath))
}

async function readLoadableFiles(directory: string) {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(directory, entry.name))
      .filter(isLoadableModuleFile)
      .sort((left, right) => left.localeCompare(right))
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return []
    }
    throw error
  }
}

function rewriteSimpleEsmExports(source: string) {
  return source
    .replace(/export\s+default\s+/g, 'module.exports.default = ')
    .replace(/export\s+const\s+([A-Za-z_$][\w$]*)\s*=/g, 'exports.$1 =')
    .replace(/export\s+let\s+([A-Za-z_$][\w$]*)\s*=/g, 'exports.$1 =')
    .replace(/export\s+var\s+([A-Za-z_$][\w$]*)\s*=/g, 'exports.$1 =')
    .replace(
      /export\s+async\s+function\s+([A-Za-z_$][\w$]*)\s*\(/g,
      'exports.$1 = async function $1(',
    )
    .replace(
      /export\s+function\s+([A-Za-z_$][\w$]*)\s*\(/g,
      'exports.$1 = function $1(',
    )
}

async function defaultModuleLoader(filePath: string) {
  if (path.extname(filePath) === '.cjs') {
    return createRequire(import.meta.url)(filePath) as Record<string, unknown>
  }

  const source = await readFile(filePath, 'utf8')
  const exports: Record<string, unknown> = {}
  const module = { exports }
  const require = createRequire(pathToFileURL(filePath))
  const execute = new Function(
    'exports',
    'module',
    'require',
    '__filename',
    '__dirname',
    rewriteSimpleEsmExports(source),
  )
  execute(exports, module, require, filePath, path.dirname(filePath))
  return isRecord(module.exports) ? module.exports : exports
}

function createOpenCodeToolContext(context: ToolContext): OpenCodeToolContext {
  return {
    agent: context.agent,
    sessionID: context.sessionId,
    messageID: context.messageId,
    directory: context.workspaceRoot,
    worktree: context.workspaceRoot,
    abortSignal: context.abortSignal,
    specter: context,
  }
}

function isOpenCodeToolShape(value: unknown): value is OpenCodeToolShape {
  return isRecord(value) && typeof value.execute === 'function'
}

function isOpenCodeV1ServerPlugin(
  value: unknown,
): value is OpenCodeV1ServerPlugin {
  return isRecord(value) && typeof value.server === 'function'
}

function toolNameForExport(filePath: string, exportName: string) {
  const baseName = path.basename(filePath, path.extname(filePath))
  return exportName === 'default' ? baseName : `${baseName}_${exportName}`
}

function toSpecterTool(name: string, tool: OpenCodeToolShape): ToolDefinition {
  return {
    name,
    description: tool.description,
    permission: 'tool.custom',
    permissionTarget: () => name,
    execute(input, context) {
      return tool.execute(input, createOpenCodeToolContext(context))
    },
  }
}

function registerTool(
  registry: ToolRegistry,
  name: string,
  tool: OpenCodeToolShape,
  kind: ToolExtensionLoadResult['kind'],
  source: string,
): ToolExtensionLoadResult {
  registry.register(toSpecterTool(name, tool), { replace: true })
  return { kind, name, source }
}

async function loadCustomToolFile(input: {
  registry: ToolRegistry
  filePath: string
  moduleLoader: (filePath: string) => Promise<Record<string, unknown>>
}) {
  const mod = await input.moduleLoader(input.filePath)
  const loaded: ToolExtensionLoadResult[] = []

  for (const [exportName, value] of Object.entries(mod)) {
    if (!isOpenCodeToolShape(value)) continue
    loaded.push(
      registerTool(
        input.registry,
        toolNameForExport(input.filePath, exportName),
        value,
        'custom-tool',
        input.filePath,
      ),
    )
  }

  return loaded
}

function readPluginTools(hooks: unknown): Record<string, OpenCodeToolShape> {
  if (!isRecord(hooks) || !isRecord(hooks.tool)) return {}

  return Object.fromEntries(
    Object.entries(hooks.tool).filter(
      (entry): entry is [string, OpenCodeToolShape] =>
        isOpenCodeToolShape(entry[1]),
    ),
  )
}

async function loadPluginFile(input: {
  registry: ToolRegistry
  filePath: string
  moduleLoader: (filePath: string) => Promise<Record<string, unknown>>
  pluginInput: OpenCodePluginInput
  pluginOptions?: OpenCodePluginOptions
}) {
  const mod = await input.moduleLoader(input.filePath)
  const loaded: ToolExtensionLoadResult[] = []
  const seenFactories = new Set<unknown>()

  if (isOpenCodeV1ServerPlugin(mod.default)) {
    const hooks = await mod.default.server(
      input.pluginInput,
      input.pluginOptions,
    )
    for (const [name, tool] of Object.entries(readPluginTools(hooks))) {
      loaded.push(
        registerTool(input.registry, name, tool, 'plugin-tool', input.filePath),
      )
    }
  }

  for (const value of Object.values(mod)) {
    if (typeof value !== 'function' || seenFactories.has(value)) continue
    seenFactories.add(value)
    const hooks = await value(input.pluginInput, input.pluginOptions)
    for (const [name, tool] of Object.entries(readPluginTools(hooks))) {
      loaded.push(
        registerTool(input.registry, name, tool, 'plugin-tool', input.filePath),
      )
    }
  }

  return loaded
}

async function discoverCustomToolFiles(
  options: LoadOpenCodeToolExtensionsOptions,
) {
  const directories = [
    options.globalConfigDir
      ? path.join(options.globalConfigDir, 'tools')
      : undefined,
    path.join(options.workspaceRoot, '.opencode', 'tools'),
  ].filter((value): value is string => typeof value === 'string')

  const groups = await Promise.all(
    directories.map((directory) => readLoadableFiles(directory)),
  )
  return groups.flat()
}

function pluginFileSpec(
  entry: SpecterCodePluginEntry,
): PluginFileSpec | undefined {
  const filePath = Array.isArray(entry) ? entry[0] : entry
  const options = Array.isArray(entry) ? entry[1] : undefined
  if (!isLoadableModuleFile(filePath)) return undefined
  return { filePath, options }
}

async function discoverPluginFiles(options: LoadOpenCodeToolExtensionsOptions) {
  const configured = (options.config?.plugin ?? [])
    .map(pluginFileSpec)
    .filter((value): value is PluginFileSpec => value !== undefined)
  const directories = [
    options.globalConfigDir
      ? path.join(options.globalConfigDir, 'plugins')
      : undefined,
    path.join(options.workspaceRoot, '.opencode', 'plugins'),
  ].filter((value): value is string => typeof value === 'string')

  const groups = await Promise.all(
    directories.map((directory) => readLoadableFiles(directory)),
  )
  return [
    ...configured,
    ...groups.flat().map((filePath): PluginFileSpec => ({ filePath })),
  ]
}

export async function loadOpenCodeToolExtensionsIntoRegistry(
  options: LoadOpenCodeToolExtensionsOptions,
): Promise<ToolExtensionLoadResult[]> {
  const moduleLoader = options.moduleLoader ?? defaultModuleLoader
  const loaded: ToolExtensionLoadResult[] = []

  for (const filePath of await discoverCustomToolFiles(options)) {
    loaded.push(
      ...(await loadCustomToolFile({
        registry: options.registry,
        filePath,
        moduleLoader,
      })),
    )
  }

  const pluginInput: OpenCodePluginInput = {
    directory: options.workspaceRoot,
    worktree: options.workspaceRoot,
    project: { directory: options.workspaceRoot },
    client: {},
  }
  for (const pluginFile of await discoverPluginFiles(options)) {
    loaded.push(
      ...(await loadPluginFile({
        registry: options.registry,
        filePath: pluginFile.filePath,
        moduleLoader,
        pluginInput,
        pluginOptions: pluginFile.options,
      })),
    )
  }

  return loaded
}
