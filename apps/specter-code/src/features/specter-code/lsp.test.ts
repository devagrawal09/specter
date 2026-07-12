import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ToolContext } from './adapters/tool-registry'
import { collectTypeScriptDiagnostics, findWorkspaceSymbols } from './adapters/lsp'
import { lspTool } from './tools/lsp'

let workspaceRoot: string

const createContext = (overrides: Partial<ToolContext> = {}): ToolContext => ({
  sessionId: 'session-lsp-1',
  messageId: 'message-lsp-1',
  agent: 'build',
  workspaceRoot,
  abortSignal: new AbortController().signal,
  ask: vi.fn(async () => 'allow' as const),
  metadata: vi.fn(),
  ...overrides,
})

beforeEach(async () => {
  workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'specter-code-lsp-'))
  await mkdir(path.join(workspaceRoot, 'src'), { recursive: true })
  await writeFile(
    path.join(workspaceRoot, 'src', 'app.ts'),
    [
      'export const count: number = "oops"',
      'export function makeGreeting(name: string) {',
      '  return `hello ${name}`',
      '}',
      'export class Greeter {}',
      '',
    ].join('\n'),
  )
})

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true })
})

describe('LSP adapter and tool', () => {
  it('collects TypeScript diagnostics with workspace-relative paths and source positions', async () => {
    await expect(collectTypeScriptDiagnostics({ workspaceRoot, include: ['src/app.ts'] })).resolves.toEqual([
      expect.objectContaining({
        path: 'src/app.ts',
        lineNumber: 1,
        category: 'error',
        code: 2322,
        message: expect.stringContaining("Type 'string' is not assignable to type 'number'"),
      }),
    ])
  })

  it('finds TypeScript workspace symbols and exposes them through the lsp tool', async () => {
    await expect(findWorkspaceSymbols({ workspaceRoot, query: 'greet' })).resolves.toEqual([
      { path: 'src/app.ts', lineNumber: 2, name: 'makeGreeting', kind: 'function' },
      { path: 'src/app.ts', lineNumber: 5, name: 'Greeter', kind: 'class' },
    ])

    const context = createContext()
    await expect(lspTool.execute({ action: 'symbols', query: 'greet' }, context)).resolves.toEqual({
      action: 'symbols',
      query: 'greet',
      symbols: [
        { path: 'src/app.ts', lineNumber: 2, name: 'makeGreeting', kind: 'function' },
        { path: 'src/app.ts', lineNumber: 5, name: 'Greeter', kind: 'class' },
      ],
      truncated: false,
    })
    expect(context.metadata).toHaveBeenCalledWith({
      toolName: 'lsp',
      status: 'completed',
      summary: 'Found 2 symbols for greet',
    })
  })

  it('blocks unsafe paths and reports diagnostic summaries through the lsp tool', async () => {
    await expect(collectTypeScriptDiagnostics({ workspaceRoot, include: ['../escape.ts'] })).rejects.toThrow(
      'Workspace path escapes the workspace root',
    )

    const context = createContext()
    await expect(lspTool.execute({ action: 'diagnostics', include: ['src/app.ts'] }, context)).resolves.toEqual({
      action: 'diagnostics',
      diagnostics: [
        expect.objectContaining({ path: 'src/app.ts', lineNumber: 1, category: 'error', code: 2322 }),
      ],
      truncated: false,
    })
    expect(context.metadata).toHaveBeenCalledWith({
      toolName: 'lsp',
      status: 'completed',
      summary: 'Found 1 TypeScript diagnostic',
    })
  })
})
