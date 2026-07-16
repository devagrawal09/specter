import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createToolRegistry, type ToolContext } from './adapters/tool-registry'
import { globTool } from './tools/glob'
import { grepTool } from './tools/grep'
import { readTool } from './tools/read'

let workspaceRoot: string

const createContext = (overrides: Partial<ToolContext> = {}): ToolContext => ({
  sessionId: 'session-tools-1',
  messageId: 'message-tools-1',
  agent: 'build',
  workspaceRoot,
  abortSignal: new AbortController().signal,
  ask: vi.fn(async () => 'allow' as const),
  metadata: vi.fn(),
  ...overrides,
})

beforeEach(async () => {
  workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'specter-code-tools-'))
  await mkdir(path.join(workspaceRoot, 'src', 'nested'), { recursive: true })
  await mkdir(path.join(workspaceRoot, 'node_modules', 'ignored'), {
    recursive: true,
  })
  await writeFile(
    path.join(workspaceRoot, 'README.md'),
    'Specter Code\nAgent workspace\n',
  )
  await writeFile(
    path.join(workspaceRoot, 'src', 'app.ts'),
    'export const toolName = read\nexport const status = ready\n',
  )
  await writeFile(
    path.join(workspaceRoot, 'src', 'nested', 'notes.md'),
    'TODO: wire grep\n',
  )
  await writeFile(
    path.join(workspaceRoot, 'node_modules', 'ignored', 'noise.ts'),
    'TODO: ignore me\n',
  )
})

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true })
})

describe('read/search tools', () => {
  it('reads workspace files through the registry with normalized paths and truncation metadata', async () => {
    const registry = createToolRegistry()
    registry.register(readTool)
    const context = createContext()
    const windowsStylePath = ['src', 'app.ts'].join(String.fromCharCode(92))

    await expect(
      registry.execute(
        'read',
        { path: windowsStylePath, maxBytes: 20 },
        context,
      ),
    ).resolves.toEqual({
      path: 'src/app.ts',
      content: 'export const toolNam',
      sizeBytes: 57,
      truncated: true,
    })
    expect(context.ask).toHaveBeenCalledWith({
      permission: 'file.read',
      target: 'src/app.ts',
    })
    expect(context.metadata).toHaveBeenCalledWith({
      toolName: 'read',
      status: 'completed',
      summary: 'Read src/app.ts (truncated)',
    })
  })

  it('blocks path escapes and symlink traversal before reading', async () => {
    await symlink(
      path.dirname(workspaceRoot),
      path.join(workspaceRoot, 'outside-link'),
      'dir',
    )
    const context = createContext()

    await expect(
      readTool.execute({ path: '../outside.txt' }, context),
    ).rejects.toThrow('Workspace path escapes the workspace root')
    await expect(
      readTool.execute({ path: 'outside-link/secret.txt' }, context),
    ).rejects.toThrow('Workspace path must not traverse symlinks')
  })

  it('globs safe workspace files in deterministic order while skipping ignored directories', async () => {
    const registry = createToolRegistry()
    registry.register(globTool)
    const context = createContext()

    await expect(
      registry.execute('glob', { pattern: '**/*.ts', limit: 5 }, context),
    ).resolves.toEqual({
      pattern: '**/*.ts',
      matches: ['src/app.ts'],
      truncated: false,
    })
    expect(context.ask).toHaveBeenCalledWith({
      permission: 'file.read',
      target: '**/*.ts',
    })
  })

  it('greps matching lines across globbed files and marks output truncated at the match limit', async () => {
    const registry = createToolRegistry()
    registry.register(grepTool)
    const context = createContext()

    await expect(
      registry.execute(
        'grep',
        { pattern: 'TODO|ready', include: '**/*.{md,ts}', maxMatches: 2 },
        context,
      ),
    ).resolves.toEqual({
      pattern: 'TODO|ready',
      include: '**/*.{md,ts}',
      matches: [
        {
          path: 'src/app.ts',
          lineNumber: 2,
          line: 'export const status = ready',
        },
        { path: 'src/nested/notes.md', lineNumber: 1, line: 'TODO: wire grep' },
      ],
      truncated: true,
    })
    expect(context.ask).toHaveBeenCalledWith({
      permission: 'file.read',
      target: '**/*.{md,ts}:TODO|ready',
    })
  })
})
