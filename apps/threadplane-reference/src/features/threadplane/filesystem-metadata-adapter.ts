import { access, readdir, lstat } from 'node:fs/promises'
import path from 'node:path'

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  '.turbo',
  '.vite',
  '.next',
])

export type FilesystemNodeKind = 'file' | 'directory'

export type FilesystemNodeSnapshot = {
  path: string
  parentPath: string | null
  name: string
  kind: FilesystemNodeKind
  sizeBytes: number | null
  modifiedAt?: string
}

const normalizeRelativePath = (input: string): string => {
  const normalized = path.posix.normalize(input.replaceAll('\\', '/'))
  if (
    !normalized ||
    normalized === '.' ||
    normalized.startsWith('..') ||
    path.isAbsolute(normalized)
  ) {
    throw new Error('Filesystem path must be relative and normalized')
  }
  return normalized
}

export const resolveWorkspaceRoot = (workspaceId: string): string => {
  const baseRoot =
    process.env.THREADPLANE_WORKSPACE_ROOT ??
    path.join(process.cwd(), 'data', 'threadplane-workspaces')
  const resolved = path.resolve(baseRoot, workspaceId)
  const baseResolved = path.resolve(baseRoot)
  if (
    resolved !== baseResolved &&
    !resolved.startsWith(`${baseResolved}${path.sep}`)
  ) {
    throw new Error('Workspace root escapes base directory')
  }
  return resolved
}

const isInsideRoot = (root: string, candidate: string) => {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
  )
}

export const scanWorkspaceFilesystem = async (
  workspaceId: string,
): Promise<FilesystemNodeSnapshot[]> => {
  const root = resolveWorkspaceRoot(workspaceId)
  await access(root)
  const rootStat = await lstat(root)
  if (rootStat.isSymbolicLink())
    throw new Error('Workspace root must not be a symlink')
  if (!rootStat.isDirectory())
    throw new Error('Workspace root must be a directory')

  const snapshots: FilesystemNodeSnapshot[] = []

  const walk = async (currentAbsPath: string, relativePath: string | null) => {
    const entries = await readdir(currentAbsPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue
      const absolutePath = path.join(currentAbsPath, entry.name)
      const statResult = await lstat(absolutePath)
      if (statResult.isSymbolicLink()) continue
      const nodePath = relativePath
        ? `${relativePath}/${entry.name}`
        : entry.name
      if (!isInsideRoot(root, path.join(root, nodePath))) continue
      snapshots.push({
        path: normalizeRelativePath(nodePath),
        parentPath: relativePath,
        name: entry.name,
        kind: statResult.isDirectory() ? 'directory' : 'file',
        sizeBytes: statResult.isDirectory() ? null : statResult.size,
        modifiedAt: statResult.mtime.toISOString(),
      })
      if (statResult.isDirectory())
        await walk(absolutePath, normalizeRelativePath(nodePath))
    }
  }

  await walk(root, null)
  return snapshots
}
