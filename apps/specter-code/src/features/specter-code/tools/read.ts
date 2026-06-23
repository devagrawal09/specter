import { open } from 'node:fs/promises'

import type { ToolDefinition } from '../adapters/tool-registry'
import { resolveWorkspaceFile } from '../adapters/file-index'

export type ReadToolInput = {
  path: string
  maxBytes?: number
}

export type ReadToolOutput = {
  path: string
  content: string
  sizeBytes: number
  truncated: boolean
}

const DEFAULT_MAX_BYTES = 20_000
const ABSOLUTE_MAX_BYTES = 200_000

const normalizeLimit = (value: number | undefined) => {
  if (value === undefined) return DEFAULT_MAX_BYTES
  if (!Number.isFinite(value) || value < 1) throw new Error('Read maxBytes must be positive')
  return Math.min(Math.floor(value), ABSOLUTE_MAX_BYTES)
}

const normalizePermissionTarget = (inputPath: string) =>
  inputPath.trim().replaceAll('\\', '/')

export const readTool: ToolDefinition<ReadToolInput, ReadToolOutput> = {
  name: 'read',
  description: 'Read a file inside the current workspace',
  permission: 'file.read',
  permissionTarget: (input) => normalizePermissionTarget(input.path),
  async execute(input, context) {
    try {
      const maxBytes = normalizeLimit(input.maxBytes)
      const resolved = await resolveWorkspaceFile(context.workspaceRoot, input.path)
      const bytesToRead = Math.min(resolved.stat.size, maxBytes)
      const buffer = new Uint8Array(bytesToRead)
      const file = await open(resolved.absolutePath, 'r')
      try {
        const { bytesRead } = await file.read(buffer, 0, bytesToRead, 0)
        const truncated = resolved.stat.size > bytesRead
        const output = {
          path: resolved.path,
          content: new TextDecoder().decode(buffer.subarray(0, bytesRead)),
          sizeBytes: resolved.stat.size,
          truncated,
        }
        await context.metadata({
          toolName: 'read',
          status: 'completed',
          summary: `Read ${resolved.path}${truncated ? ' (truncated)' : ''}`,
        })
        return output
      } finally {
        await file.close()
      }
    } catch (error) {
      await context.metadata({
        toolName: 'read',
        status: 'failed',
        summary: error instanceof Error ? error.message : 'Read failed',
      })
      throw error
    }
  },
}
