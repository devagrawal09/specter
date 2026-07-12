import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createFileSnapshot,
  restoreFileSnapshot,
  restoreFileSnapshots,
} from './adapters/snapshots'

let workspaceRoot: string

beforeEach(async () => {
  workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'specter-code-snapshots-'))
  await mkdir(path.join(workspaceRoot, 'src'), { recursive: true })
  await writeFile(path.join(workspaceRoot, 'src', 'app.ts'), 'export const value = 1\n')
})

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true })
})

describe('snapshots adapter', () => {
  it('restores existing and newly created files from a snapshot set', async () => {
    const existingSnapshot = await createFileSnapshot({
      path: 'src/app.ts',
      absolutePath: path.join(workspaceRoot, 'src', 'app.ts'),
      existed: true,
    })
    const createdSnapshot = await createFileSnapshot({
      path: 'src/generated.ts',
      absolutePath: path.join(workspaceRoot, 'src', 'generated.ts'),
      existed: false,
    })

    await writeFile(path.join(workspaceRoot, 'src', 'app.ts'), 'export const value = 2\n')
    await writeFile(path.join(workspaceRoot, 'src', 'generated.ts'), 'export const generated = true\n')

    await expect(
      restoreFileSnapshots({ workspaceRoot, snapshots: [existingSnapshot, createdSnapshot] }),
    ).resolves.toEqual({
      restored: ['src/app.ts'],
      deleted: ['src/generated.ts'],
    })

    await expect(readFile(path.join(workspaceRoot, 'src', 'app.ts'), 'utf8')).resolves.toBe(
      'export const value = 1\n',
    )
    await expect(access(path.join(workspaceRoot, 'src', 'generated.ts'))).rejects.toThrow()
  })

  it('rejects snapshot restores that escape or traverse symlinks', async () => {
    await expect(
      restoreFileSnapshot({
        workspaceRoot,
        snapshot: { path: '../outside.ts', existed: true, content: 'nope\n' },
      }),
    ).rejects.toThrow('Snapshot path escapes the workspace root')

    await symlink(path.join(workspaceRoot, 'src'), path.join(workspaceRoot, 'link-to-src'))
    await expect(
      restoreFileSnapshot({
        workspaceRoot,
        snapshot: { path: 'link-to-src/app.ts', existed: true, content: 'nope\n' },
      }),
    ).rejects.toThrow('Snapshot path must not traverse symlinks')
  })
})
