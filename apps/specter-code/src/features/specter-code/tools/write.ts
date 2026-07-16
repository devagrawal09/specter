import { mkdir, lstat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { normalizeWorkspacePath } from '../adapters/file-index.ts'
import { createFileSnapshot, type FileSnapshot } from '../adapters/snapshots.ts'
import type { ToolDefinition } from '../adapters/tool-registry.ts'

export type WriteToolInput = {
  path: string
  content: string
}

export type WriteToolOutput = {
  path: string
  bytesWritten: number
  snapshot: FileSnapshot
}

const isInsideRoot = (root: string, candidate: string) => {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(resolvedRoot + path.sep)
  )
}

export type WriteTarget = {
  path: string
  absolutePath: string
  existed: boolean
}

export async function resolveWritableWorkspaceFile(
  workspaceRoot: string,
  inputPath: string,
): Promise<WriteTarget> {
  const relativePath = normalizeWorkspacePath(inputPath)
  const root = path.resolve(workspaceRoot)
  const rootStat = await lstat(root)
  if (rootStat.isSymbolicLink())
    throw new Error('Workspace root must not be a symlink')
  if (!rootStat.isDirectory())
    throw new Error('Workspace root must be a directory')

  const segments = relativePath.split('/')
  let current = root
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment)
    if (!isInsideRoot(root, current))
      throw new Error('Workspace path escapes the workspace root')
    const stat = await lstat(current)
    if (stat.isSymbolicLink())
      throw new Error('Workspace path must not traverse symlinks')
    if (!stat.isDirectory())
      throw new Error('Workspace parent path must be a directory')
  }

  const absolutePath = path.join(root, ...segments)
  if (!isInsideRoot(root, absolutePath))
    throw new Error('Workspace path escapes the workspace root')

  try {
    const stat = await lstat(absolutePath)
    if (stat.isSymbolicLink())
      throw new Error('Workspace path must not traverse symlinks')
    if (!stat.isFile()) throw new Error('Workspace path must be a file')
    return { path: relativePath, absolutePath, existed: true }
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return { path: relativePath, absolutePath, existed: false }
    }
    throw error
  }
}

export const writeTool: ToolDefinition<WriteToolInput, WriteToolOutput> = {
  name: 'write',
  description:
    'Write a complete file inside the current workspace after approval',
  permission: 'file.write',
  permissionTarget: (input) => normalizeWorkspacePath(input.path),
  async execute(input, context) {
    let targetPath = input.path
    try {
      const target = await resolveWritableWorkspaceFile(
        context.workspaceRoot,
        input.path,
      )
      targetPath = target.path
      const snapshot = await createFileSnapshot(target)
      await mkdir(path.dirname(target.absolutePath), { recursive: true })
      await writeFile(target.absolutePath, input.content, 'utf8')

      await context.metadata({
        toolName: 'write',
        status: 'completed',
        summary: 'Wrote ' + target.path,
      })
      return {
        path: target.path,
        bytesWritten: Buffer.byteLength(input.content, 'utf8'),
        snapshot,
      }
    } catch (error) {
      await context.metadata({
        toolName: 'write',
        status: 'failed',
        summary:
          error instanceof Error
            ? error.message
            : 'Write failed for ' + targetPath,
      })
      throw error
    }
  },
}
