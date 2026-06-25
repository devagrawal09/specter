import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createToolRegistry, type ToolContext } from './adapters/tool-registry'
import {
  loadOpenCodeToolExtensionsIntoRegistry,
  type ToolExtensionLoadResult,
} from './adapters/plugin-loader'

let workspaceRoot: string
let globalConfigDir: string

const createContext = (overrides: Partial<ToolContext> = {}): ToolContext => ({
  sessionId: 'session-plugin-1',
  messageId: 'message-plugin-1',
  agent: 'build',
  workspaceRoot,
  abortSignal: new AbortController().signal,
  ask: vi.fn(async () => 'allow' as const),
  metadata: vi.fn(),
  ...overrides,
})

async function writeModule(relativePath: string, source: string) {
  const absolutePath = path.join(workspaceRoot, relativePath)
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, source)
  return absolutePath
}

beforeEach(async () => {
  workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'specter-code-plugin-tools-'))
  globalConfigDir = await mkdtemp(path.join(os.tmpdir(), 'specter-code-global-'))
})

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true })
  await rm(globalConfigDir, { recursive: true, force: true })
})

describe('OpenCode-compatible tool extension loading', () => {
  it('loads project custom tool files using default and named export naming', async () => {
    await writeModule(
      '.opencode/tools/database.mjs',
      `export default {
        description: 'Query the project database',
        async execute(args, context) {
          return {
            query: args.query,
            sessionID: context.sessionID,
            messageID: context.messageID,
            directory: context.directory,
            worktree: context.worktree,
            agent: context.agent,
          }
        },
      }`,
    )
    await writeModule(
      '.opencode/tools/math.mjs',
      `export const add = {
        description: 'Add two numbers',
        execute(args) { return args.a + args.b },
      }
      export const multiply = {
        description: 'Multiply two numbers',
        execute(args) { return args.a * args.b },
      }`,
    )
    const registry = createToolRegistry()

    const loaded = await loadOpenCodeToolExtensionsIntoRegistry({
      registry,
      workspaceRoot,
      globalConfigDir,
    })

    expect(loaded).toEqual<ToolExtensionLoadResult[]>([
      expect.objectContaining({ kind: 'custom-tool', name: 'database' }),
      expect.objectContaining({ kind: 'custom-tool', name: 'math_add' }),
      expect.objectContaining({ kind: 'custom-tool', name: 'math_multiply' }),
    ])
    expect(registry.list().map((tool) => tool.name)).toEqual([
      'database',
      'math_add',
      'math_multiply',
    ])
    const context = createContext()
    await expect(
      registry.execute('database', { query: 'select 1' }, context),
    ).resolves.toEqual({
      query: 'select 1',
      sessionID: 'session-plugin-1',
      messageID: 'message-plugin-1',
      directory: workspaceRoot,
      worktree: workspaceRoot,
      agent: 'build',
    })
    expect(context.ask).toHaveBeenCalledWith({
      permission: 'tool.custom',
      target: 'database',
    })
    await expect(registry.execute('math_add', { a: 2, b: 3 }, createContext())).resolves.toBe(5)
  })

  it('lets custom tool files replace a built-in registry tool by name', async () => {
    await writeModule(
      '.opencode/tools/bash.mjs',
      `export default {
        description: 'Restricted bash wrapper',
        execute(args) { return 'blocked: ' + args.command },
      }`,
    )
    const registry = createToolRegistry()
    registry.register({
      name: 'bash',
      description: 'Built-in shell',
      permission: 'shell.execute',
      execute: async () => 'ran',
    })

    await loadOpenCodeToolExtensionsIntoRegistry({ registry, workspaceRoot })

    expect(registry.list()).toEqual([
      { name: 'bash', description: 'Restricted bash wrapper', permission: 'tool.custom' },
    ])
    await expect(
      registry.execute('bash', { command: 'rm -rf /' }, createContext()),
    ).resolves.toBe('blocked: rm -rf /')
  })

  it('loads custom tools exposed by configured plugins and project plugin files', async () => {
    const configuredPlugin = await writeModule(
      'specter-plugin.mjs',
      `export const SpecterPlugin = async () => ({
        tool: {
          shout: {
            description: 'Shout text',
            execute(args) { return String(args.text).toUpperCase() },
          },
        },
      })`,
    )
    await writeModule(
      '.opencode/plugins/local-tools.mjs',
      `export default async () => ({
        tool: {
          greet: {
            description: 'Greet from project plugin',
            execute(args, context) { return 'hello ' + args.name + ' from ' + context.directory },
          },
        },
      })`,
    )
    const registry = createToolRegistry()

    const loaded = await loadOpenCodeToolExtensionsIntoRegistry({
      registry,
      workspaceRoot,
      config: { plugin: [configuredPlugin] },
    })

    expect(loaded.map((entry) => `${entry.kind}:${entry.name}`)).toEqual([
      'plugin-tool:shout',
      'plugin-tool:greet',
    ])
    await expect(registry.execute('shout', { text: 'specter' }, createContext())).resolves.toBe('SPECTER')
    await expect(registry.execute('greet', { name: 'Ada' }, createContext())).resolves.toBe(
      `hello Ada from ${workspaceRoot}`,
    )
  })
})
