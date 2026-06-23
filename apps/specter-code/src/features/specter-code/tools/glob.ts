import type { ToolDefinition } from '../adapters/tool-registry'
import {
  listWorkspaceFiles,
  matchesWorkspaceGlob,
  normalizeWorkspaceGlobPattern,
} from '../adapters/file-index'

export type GlobToolInput = {
  pattern: string
  limit?: number
}

export type GlobToolOutput = {
  pattern: string
  matches: string[]
  truncated: boolean
}

const DEFAULT_LIMIT = 100
const ABSOLUTE_LIMIT = 1_000

const normalizeLimit = (value: number | undefined) => {
  if (value === undefined) return DEFAULT_LIMIT
  if (!Number.isFinite(value) || value < 1) throw new Error('Glob limit must be positive')
  return Math.min(Math.floor(value), ABSOLUTE_LIMIT)
}

export const globTool: ToolDefinition<GlobToolInput, GlobToolOutput> = {
  name: 'glob',
  description: 'Find files in the workspace by glob pattern',
  permission: 'file.read',
  permissionTarget: (input) => normalizeWorkspaceGlobPattern(input.pattern),
  async execute(input, context) {
    const pattern = normalizeWorkspaceGlobPattern(input.pattern)
    const limit = normalizeLimit(input.limit)
    const allMatches = (await listWorkspaceFiles(context.workspaceRoot))
      .map((file) => file.path)
      .filter((filePath) => matchesWorkspaceGlob(pattern, filePath))
    const matches = allMatches.slice(0, limit)
    const truncated = allMatches.length > matches.length
    await context.metadata({
      toolName: 'glob',
      status: 'completed',
      summary: `Matched ${matches.length} file${matches.length === 1 ? '' : 's'}${truncated ? ' (truncated)' : ''}`,
    })
    return { pattern, matches, truncated }
  },
}
