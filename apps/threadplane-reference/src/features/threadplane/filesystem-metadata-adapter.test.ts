import { mkdir, mkdtemp, writeFile, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  resolveWorkspaceRoot,
  scanWorkspaceFilesystem,
} from './filesystem-metadata-adapter'

describe('filesystem metadata adapter', () => {
  it('scans nodes and ignores generated directories', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'threadplane-fs-'))
    const root = path.join(base, 'workspace-1')
    await mkdir(path.join(root, 'src'), { recursive: true })
    await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true })
    await writeFile(path.join(root, 'src', 'index.ts'), 'console.log(1)')
    await writeFile(path.join(root, 'node_modules', 'pkg', 'ignored.txt'), 'x')

    process.env.THREADPLANE_WORKSPACE_ROOT = base
    const nodes = await scanWorkspaceFilesystem('workspace-1')

    expect(nodes.map((node) => node.path)).toEqual(['src', 'src/index.ts'])
  })

  it('rejects workspace roots that escape containment', () => {
    process.env.THREADPLANE_WORKSPACE_ROOT = '/tmp/threadplane-base'
    expect(() => resolveWorkspaceRoot('../escape')).toThrow(
      'Workspace root escapes base directory',
    )
  })

  it('skips symlink escapes', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'threadplane-fs-'))
    const root = path.join(base, 'workspace-1')
    const outside = path.join(base, 'outside')
    await mkdir(root, { recursive: true })
    await mkdir(outside, { recursive: true })
    await writeFile(path.join(outside, 'secret.txt'), 'nope')
    await symlink(outside, path.join(root, 'link-out'))

    process.env.THREADPLANE_WORKSPACE_ROOT = base
    const nodes = await scanWorkspaceFilesystem('workspace-1')

    expect(nodes).toEqual([])
  })
})
