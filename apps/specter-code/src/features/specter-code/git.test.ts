import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  applyGitPatch,
  getGitDiff,
  getGitStatus,
  revertWorkspacePaths,
} from './adapters/git'

const execFileAsync = promisify(execFile)

let workspaceRoot: string

async function git(args: string[]) {
  return execFileAsync('git', args, { cwd: workspaceRoot })
}

beforeEach(async () => {
  workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'specter-code-git-'))
  await mkdir(path.join(workspaceRoot, 'src'), { recursive: true })
  await git(['init', '-b', 'main'])
  await git(['config', 'user.email', 'specter-code@example.test'])
  await git(['config', 'user.name', 'Specter Code Tests'])
  await writeFile(path.join(workspaceRoot, 'src', 'app.ts'), 'export const value = 1\n')
  await git(['add', 'src/app.ts'])
  await git(['commit', '-m', 'initial'])
})

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true })
})

describe('git adapter', () => {
  it('reports porcelain status entries and scoped workspace diffs', async () => {
    await writeFile(path.join(workspaceRoot, 'src', 'app.ts'), 'export const value = 2\n')
    await writeFile(path.join(workspaceRoot, 'notes.md'), '# Notes\n')

    await expect(getGitStatus({ workspaceRoot })).resolves.toEqual({
      branch: 'main',
      clean: false,
      entries: [
        { path: 'src/app.ts', index: ' ', workingTree: 'M' },
        { path: 'notes.md', index: '?', workingTree: '?' },
      ],
    })

    await expect(getGitDiff({ workspaceRoot, path: 'src/app.ts' })).resolves.toEqual(
      expect.objectContaining({
        staged: false,
        path: 'src/app.ts',
        patch: expect.stringContaining('-export const value = 1'),
      }),
    )
    const diff = await getGitDiff({ workspaceRoot, path: 'src/app.ts' })
    expect(diff.patch).toContain('+export const value = 2')
  })

  it('applies unified patches and reverts tracked and untracked workspace paths', async () => {
    const patchText = [
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1 +1,2 @@',
      ' export const value = 1',
      '+export const label = "patched"',
      '',
    ].join('\n')

    await expect(applyGitPatch({ workspaceRoot, patch: patchText })).resolves.toEqual({
      paths: ['src/app.ts'],
      staged: false,
    })
    await expect(readFile(path.join(workspaceRoot, 'src', 'app.ts'), 'utf8')).resolves.toBe(
      'export const value = 1\nexport const label = "patched"\n',
    )

    await writeFile(path.join(workspaceRoot, 'scratch.txt'), 'temporary\n')
    await expect(
      revertWorkspacePaths({ workspaceRoot, paths: ['src/app.ts', 'scratch.txt'] }),
    ).resolves.toEqual({ paths: ['src/app.ts', 'scratch.txt'] })
    await expect(readFile(path.join(workspaceRoot, 'src', 'app.ts'), 'utf8')).resolves.toBe(
      'export const value = 1\n',
    )
    await expect(access(path.join(workspaceRoot, 'scratch.txt'))).rejects.toThrow()
  })

  it('rejects workspace path escapes before executing git operations', async () => {
    await expect(getGitDiff({ workspaceRoot, path: '../outside.txt' })).rejects.toThrow(
      'Git path escapes the workspace root',
    )

    const escapingPatch = [
      '--- /dev/null',
      '+++ b/../outside.txt',
      '@@ -0,0 +1 @@',
      '+nope',
      '',
    ].join('\n')
    await expect(applyGitPatch({ workspaceRoot, patch: escapingPatch })).rejects.toThrow(
      'Git patch path escapes the workspace root',
    )
  })
})
