import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  PermissionRequest,
  PermissionAction,
} from './adapters/permissions'
import { createToolRegistry, type ToolContext } from './adapters/tool-registry'
import { applyPatchTool } from './tools/apply-patch'
import { editTool } from './tools/edit'
import { writeTool } from './tools/write'

let workspaceRoot: string

const createContext = (overrides: Partial<ToolContext> = {}): ToolContext => ({
  sessionId: 'session-edit-1',
  messageId: 'message-edit-1',
  agent: 'build',
  workspaceRoot,
  abortSignal: new AbortController().signal,
  ask: vi.fn(async () => 'allow' as PermissionAction),
  metadata: vi.fn(),
  ...overrides,
})

beforeEach(async () => {
  workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), 'specter-code-edit-tools-'),
  )
  await mkdir(path.join(workspaceRoot, 'src'), { recursive: true })
  await writeFile(
    path.join(workspaceRoot, 'src', 'app.ts'),
    'export const value = 1\n',
  )
})

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true })
})

describe('write/edit/apply_patch tools', () => {
  it('writes a workspace file only after approval and creates a reversible snapshot', async () => {
    const ask = vi.fn(
      async (_request: PermissionRequest) => 'allow' as PermissionAction,
    )
    const context = createContext({ ask })
    const registry = createToolRegistry()
    registry.register(writeTool)

    await expect(
      registry.execute(
        'write',
        { path: 'src/app.ts', content: 'export const value = 2\n' },
        context,
      ),
    ).resolves.toEqual({
      path: 'src/app.ts',
      bytesWritten: 23,
      snapshot: {
        path: 'src/app.ts',
        existed: true,
        content: 'export const value = 1\n',
      },
    })

    await expect(
      readFile(path.join(workspaceRoot, 'src', 'app.ts'), 'utf8'),
    ).resolves.toBe('export const value = 2\n')
    expect(ask).toHaveBeenCalledWith({
      permission: 'file.write',
      target: 'src/app.ts',
    })
    expect(context.metadata).toHaveBeenCalledWith({
      toolName: 'write',
      status: 'completed',
      summary: 'Wrote src/app.ts',
    })
  })

  it('honors write allow permission rules through the registry without prompting', async () => {
    const ask = vi.fn(
      async (_request: PermissionRequest) => 'deny' as PermissionAction,
    )
    const context = createContext({
      ask,
      permissionRules: [
        { permission: 'file.write', pattern: 'src/**', action: 'allow' },
      ],
    })
    const registry = createToolRegistry()
    registry.register(writeTool)

    await expect(
      registry.execute(
        'write',
        { path: 'src/app.ts', content: 'export const value = 22\n' },
        context,
      ),
    ).resolves.toMatchObject({ path: 'src/app.ts', bytesWritten: 24 })
    expect(ask).not.toHaveBeenCalled()
    await expect(
      readFile(path.join(workspaceRoot, 'src', 'app.ts'), 'utf8'),
    ).resolves.toBe('export const value = 22\n')
  })

  it('honors edit deny permission rules through the registry without mutating files', async () => {
    const ask = vi.fn(
      async (_request: PermissionRequest) => 'allow' as PermissionAction,
    )
    const context = createContext({
      ask,
      permissionRules: [
        { permission: 'file.write', pattern: 'src/app.ts', action: 'deny' },
      ],
    })
    const registry = createToolRegistry()
    registry.register(editTool)

    await expect(
      registry.execute(
        'edit',
        { path: 'src/app.ts', oldString: 'value = 1', newString: 'value = 99' },
        context,
      ),
    ).rejects.toThrow('Tool denied: edit for src/app.ts')
    expect(ask).not.toHaveBeenCalled()
    await expect(
      readFile(path.join(workspaceRoot, 'src', 'app.ts'), 'utf8'),
    ).resolves.toBe('export const value = 1\n')
  })

  it('edits a file by replacing an exact string and snapshots the original content', async () => {
    const context = createContext()
    const registry = createToolRegistry()
    registry.register(editTool)

    await expect(
      registry.execute(
        'edit',
        { path: 'src/app.ts', oldString: 'value = 1', newString: 'value = 3' },
        context,
      ),
    ).resolves.toEqual({
      path: 'src/app.ts',
      replacements: 1,
      snapshot: {
        path: 'src/app.ts',
        existed: true,
        content: 'export const value = 1\n',
      },
    })

    await expect(
      readFile(path.join(workspaceRoot, 'src', 'app.ts'), 'utf8'),
    ).resolves.toBe('export const value = 3\n')
    expect(context.ask).toHaveBeenCalledWith({
      permission: 'file.write',
      target: 'src/app.ts',
    })
    expect(context.metadata).toHaveBeenCalledWith({
      toolName: 'edit',
      status: 'completed',
      summary: 'Edited src/app.ts (1 replacement)',
    })
  })

  it('applies a unified patch with approval and returns changed file snapshots', async () => {
    const context = createContext()
    const registry = createToolRegistry()
    registry.register(applyPatchTool)
    const patch = [
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1 +1,2 @@',
      '-export const value = 1',
      '+export const value = 4',
      '+export const label = "patched"',
      '',
    ].join('\n')

    await expect(
      registry.execute('apply_patch', { patch }, context),
    ).resolves.toEqual({
      files: [
        {
          path: 'src/app.ts',
          additions: 2,
          removals: 1,
          snapshot: {
            path: 'src/app.ts',
            existed: true,
            content: 'export const value = 1\n',
          },
        },
      ],
    })

    await expect(
      readFile(path.join(workspaceRoot, 'src', 'app.ts'), 'utf8'),
    ).resolves.toBe('export const value = 4\nexport const label = "patched"\n')
    expect(context.ask).toHaveBeenCalledWith({
      permission: 'file.write',
      target: 'src/app.ts',
    })
    expect(context.metadata).toHaveBeenCalledWith({
      toolName: 'apply_patch',
      status: 'completed',
      summary: 'Applied patch to 1 file',
    })
  })

  it('honors apply_patch deny permission rules for patch target files', async () => {
    const ask = vi.fn(
      async (_request: PermissionRequest) => 'allow' as PermissionAction,
    )
    const context = createContext({
      ask,
      permissionRules: [
        { permission: 'file.write', pattern: 'src/app.ts', action: 'deny' },
      ],
    })
    const registry = createToolRegistry()
    registry.register(applyPatchTool)
    const patch = [
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1 +1 @@',
      '-export const value = 1',
      '+export const value = 44',
      '',
    ].join('\n')

    await expect(
      registry.execute('apply_patch', { patch }, context),
    ).rejects.toThrow('Tool denied: apply_patch for src/app.ts')
    expect(ask).not.toHaveBeenCalled()
    await expect(
      readFile(path.join(workspaceRoot, 'src', 'app.ts'), 'utf8'),
    ).resolves.toBe('export const value = 1\n')
  })
})
