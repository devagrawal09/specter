import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PermissionRequest, PermissionAction } from './adapters/permissions'
import type { ToolContext } from './adapters/tool-registry'
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
  workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'specter-code-edit-tools-'))
  await mkdir(path.join(workspaceRoot, 'src'), { recursive: true })
  await writeFile(path.join(workspaceRoot, 'src', 'app.ts'), 'export const value = 1\n')
})

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true })
})

describe('write/edit/apply_patch tools', () => {
  it('writes a workspace file only after approval and creates a reversible snapshot', async () => {
    const ask = vi.fn(async (_request: PermissionRequest) => 'allow' as PermissionAction)
    const context = createContext({ ask })

    await expect(
      writeTool.execute({ path: 'src/app.ts', content: 'export const value = 2\n' }, context),
    ).resolves.toEqual({
      path: 'src/app.ts',
      bytesWritten: 23,
      snapshot: {
        path: 'src/app.ts',
        existed: true,
        content: 'export const value = 1\n',
      },
    })

    await expect(readFile(path.join(workspaceRoot, 'src', 'app.ts'), 'utf8')).resolves.toBe(
      'export const value = 2\n',
    )
    expect(ask).toHaveBeenCalledWith({ permission: 'file.write', target: 'src/app.ts' })
    expect(context.metadata).toHaveBeenCalledWith({
      toolName: 'write',
      status: 'completed',
      summary: 'Wrote src/app.ts',
    })
  })

  it('edits a file by replacing an exact string and snapshots the original content', async () => {
    const context = createContext()

    await expect(
      editTool.execute(
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

    await expect(readFile(path.join(workspaceRoot, 'src', 'app.ts'), 'utf8')).resolves.toBe(
      'export const value = 3\n',
    )
    expect(context.ask).toHaveBeenCalledWith({ permission: 'file.write', target: 'src/app.ts' })
    expect(context.metadata).toHaveBeenCalledWith({
      toolName: 'edit',
      status: 'completed',
      summary: 'Edited src/app.ts (1 replacement)',
    })
  })

  it('applies a unified patch with approval and returns changed file snapshots', async () => {
    const context = createContext()
    const patch = [
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1 +1,2 @@',
      '-export const value = 1',
      '+export const value = 4',
      '+export const label = "patched"',
      '',
    ].join('\n')

    await expect(applyPatchTool.execute({ patch }, context)).resolves.toEqual({
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

    await expect(readFile(path.join(workspaceRoot, 'src', 'app.ts'), 'utf8')).resolves.toBe(
      'export const value = 4\nexport const label = "patched"\n',
    )
    expect(context.ask).toHaveBeenCalledWith({ permission: 'file.write', target: 'src/app.ts' })
    expect(context.metadata).toHaveBeenCalledWith({
      toolName: 'apply_patch',
      status: 'completed',
      summary: 'Applied patch to 1 file',
    })
  })
})
