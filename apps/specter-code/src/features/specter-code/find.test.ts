import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { findWorkspaceFiles, findWorkspaceText } from './adapters/find'

let workspaceRoot: string

beforeEach(async () => {
  workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'specter-code-find-'))
  await mkdir(path.join(workspaceRoot, 'src', 'nested'), { recursive: true })
  await mkdir(path.join(workspaceRoot, 'docs'), { recursive: true })
  await mkdir(path.join(workspaceRoot, 'node_modules', 'noise'), {
    recursive: true,
  })
  await writeFile(
    path.join(workspaceRoot, 'src', 'app.ts'),
    'export const state = "loading"\nexport const ready = true\n',
  )
  await writeFile(
    path.join(workspaceRoot, 'src', 'nested', 'worker.ts'),
    'ready()\n',
  )
  await writeFile(path.join(workspaceRoot, 'docs', 'guide.md'), 'Ready guide\n')
  await writeFile(path.join(workspaceRoot, 'README.md'), 'Project notes\n')
  await writeFile(
    path.join(workspaceRoot, 'node_modules', 'noise', 'app.ts'),
    'ready noise\n',
  )
  await writeFile(
    path.join(workspaceRoot, 'binary.bin'),
    new Uint8Array([0, 1, 2, 3]),
  )
})

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true })
})

describe('OpenCode-compatible find adapters', () => {
  it('finds files by substring or glob query with stable ordering and limits', async () => {
    await expect(
      findWorkspaceFiles({ workspaceRoot, query: 'app', limit: 10 }),
    ).resolves.toEqual(['src/app.ts'])

    await expect(
      findWorkspaceFiles({ workspaceRoot, query: '**/*.ts', limit: 1 }),
    ).resolves.toEqual(['src/app.ts'])

    await expect(
      findWorkspaceFiles({
        workspaceRoot,
        query: 'doc',
        type: 'directory',
        limit: 10,
      }),
    ).resolves.toEqual(['docs'])
  })

  it('returns ripgrep-shaped text matches while skipping ignored and binary files', async () => {
    await expect(
      findWorkspaceText({ workspaceRoot, pattern: 'ready', limit: 10 }),
    ).resolves.toEqual([
      {
        path: { text: 'src/app.ts' },
        lines: { text: 'export const ready = true' },
        line_number: 2,
        absolute_offset: 31,
        submatches: [{ match: { text: 'ready' }, start: 13, end: 18 }],
      },
      {
        path: { text: 'src/nested/worker.ts' },
        lines: { text: 'ready()' },
        line_number: 1,
        absolute_offset: 0,
        submatches: [{ match: { text: 'ready' }, start: 0, end: 5 }],
      },
    ])
  })

  it('normalizes subdirectories and blocks path escape', async () => {
    await expect(
      findWorkspaceText({
        workspaceRoot,
        directory: 'src',
        pattern: 'ready',
        limit: 10,
      }),
    ).resolves.toEqual([
      expect.objectContaining({ path: { text: 'app.ts' } }),
      expect.objectContaining({ path: { text: 'nested/worker.ts' } }),
    ])

    await expect(
      findWorkspaceFiles({
        workspaceRoot,
        directory: '../outside',
        query: 'app',
      }),
    ).rejects.toThrow('Workspace path escapes the workspace root')
  })
})
