import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type FileSnapshot = {
  path: string
  existed: boolean
  content?: string
}

export type RestoreFileSnapshotResult = {
  path: string
  action: 'restored' | 'deleted'
}

export type RestoreFileSnapshotsResult = {
  restored: string[]
  deleted: string[]
}

const isWindowsAbsolutePath = (value: string) => /^[a-zA-Z]:\//.test(value)

const normalizeSnapshotPath = (input: string) => {
  const slashNormalized = input.trim().replaceAll('\\', '/')
  if (!slashNormalized) throw new Error('Snapshot path is required')
  if (path.posix.isAbsolute(slashNormalized) || isWindowsAbsolutePath(slashNormalized)) {
    throw new Error('Snapshot path escapes the workspace root')
  }

  const normalized = path.posix.normalize(slashNormalized)
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error('Snapshot path escapes the workspace root')
  }
  return normalized
}

const isInsideRoot = (root: string, candidate: string) => {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(resolvedRoot + path.sep)
}

async function assertWorkspaceRoot(workspaceRoot: string) {
  const root = path.resolve(workspaceRoot)
  const stat = await lstat(root)
  if (stat.isSymbolicLink()) throw new Error('Workspace root must not be a symlink')
  if (!stat.isDirectory()) throw new Error('Workspace root must be a directory')
  return root
}

async function resolveSnapshotTarget(workspaceRoot: string, inputPath: string) {
  const root = await assertWorkspaceRoot(workspaceRoot)
  const relativePath = normalizeSnapshotPath(inputPath)
  const segments = relativePath.split('/')

  let current = root
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment)
    if (!isInsideRoot(root, current)) throw new Error('Snapshot path escapes the workspace root')

    try {
      const stat = await lstat(current)
      if (stat.isSymbolicLink()) throw new Error('Snapshot path must not traverse symlinks')
      if (!stat.isDirectory()) throw new Error('Snapshot parent path must be a directory')
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        break
      }
      throw error
    }
  }

  const absolutePath = path.join(root, ...segments)
  if (!isInsideRoot(root, absolutePath)) throw new Error('Snapshot path escapes the workspace root')

  try {
    const stat = await lstat(absolutePath)
    if (stat.isSymbolicLink()) throw new Error('Snapshot path must not traverse symlinks')
    if (!stat.isFile()) throw new Error('Snapshot path must be a file')
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
      throw error
    }
  }

  return { path: relativePath, absolutePath }
}

export async function createFileSnapshot(input: {
  path: string
  absolutePath: string
  existed: boolean
}): Promise<FileSnapshot> {
  const snapshotPath = normalizeSnapshotPath(input.path)
  if (!input.existed) return { path: snapshotPath, existed: false }

  return {
    path: snapshotPath,
    existed: true,
    content: await readFile(input.absolutePath, 'utf8'),
  }
}

export async function restoreFileSnapshot(input: {
  workspaceRoot: string
  snapshot: FileSnapshot
}): Promise<RestoreFileSnapshotResult> {
  const target = await resolveSnapshotTarget(input.workspaceRoot, input.snapshot.path)

  if (!input.snapshot.existed) {
    await rm(target.absolutePath, { force: true })
    return { path: target.path, action: 'deleted' }
  }

  if (input.snapshot.content === undefined) {
    throw new Error('Snapshot content is required to restore ' + target.path)
  }

  await mkdir(path.dirname(target.absolutePath), { recursive: true })
  await writeFile(target.absolutePath, input.snapshot.content, 'utf8')
  return { path: target.path, action: 'restored' }
}

export async function restoreFileSnapshots(input: {
  workspaceRoot: string
  snapshots: FileSnapshot[]
}): Promise<RestoreFileSnapshotsResult> {
  const restored: string[] = []
  const deleted: string[] = []

  for (const snapshot of input.snapshots) {
    const result = await restoreFileSnapshot({ workspaceRoot: input.workspaceRoot, snapshot })
    if (result.action === 'restored') restored.push(result.path)
    if (result.action === 'deleted') deleted.push(result.path)
  }

  return { restored, deleted }
}
