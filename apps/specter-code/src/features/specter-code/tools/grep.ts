import { readFile } from 'node:fs/promises'

import type { ToolDefinition } from '../adapters/tool-registry'
import {
  listWorkspaceFiles,
  matchesWorkspaceGlob,
  normalizeWorkspaceGlobPattern,
} from '../adapters/file-index'

export type GrepToolInput = {
  pattern: string
  include?: string
  caseSensitive?: boolean
  maxMatches?: number
}

export type GrepMatch = {
  path: string
  lineNumber: number
  line: string
}

export type GrepToolOutput = {
  pattern: string
  include: string
  matches: GrepMatch[]
  truncated: boolean
}

const DEFAULT_INCLUDE = '**/*'
const DEFAULT_MAX_MATCHES = 100
const ABSOLUTE_MAX_MATCHES = 1_000
const MAX_SEARCH_BYTES_PER_FILE = 1_000_000

const normalizeLimit = (value: number | undefined) => {
  if (value === undefined) return DEFAULT_MAX_MATCHES
  if (!Number.isFinite(value) || value < 1) throw new Error('Grep maxMatches must be positive')
  return Math.min(Math.floor(value), ABSOLUTE_MAX_MATCHES)
}

const containsNullByte = (buffer: Buffer) => buffer.includes(0)

export const grepTool: ToolDefinition<GrepToolInput, GrepToolOutput> = {
  name: 'grep',
  description: 'Search workspace files with a JavaScript regular expression',
  permission: 'file.read',
  permissionTarget: (input) =>
    `${normalizeWorkspaceGlobPattern(input.include ?? DEFAULT_INCLUDE)}:${input.pattern}`,
  async execute(input, context) {
    const include = normalizeWorkspaceGlobPattern(input.include ?? DEFAULT_INCLUDE)
    const maxMatches = normalizeLimit(input.maxMatches)
    const expression = new RegExp(input.pattern, input.caseSensitive === false ? 'i' : undefined)
    const matches: GrepMatch[] = []
    let truncated = false

    const files = (await listWorkspaceFiles(context.workspaceRoot)).filter((file) =>
      matchesWorkspaceGlob(include, file.path),
    )

    for (const file of files) {
      if (file.sizeBytes > MAX_SEARCH_BYTES_PER_FILE) continue
      const buffer = await readFile(file.absolutePath)
      if (containsNullByte(buffer)) continue
      const lines = buffer.toString('utf8').split(/\r?\n/)
      for (let index = 0; index < lines.length; index += 1) {
        if (!expression.test(lines[index])) continue
        matches.push({ path: file.path, lineNumber: index + 1, line: lines[index] })
        if (matches.length >= maxMatches) {
          truncated = true
          await context.metadata({
            toolName: 'grep',
            status: 'completed',
            summary: `Found ${matches.length} matches (truncated)`,
          })
          return { pattern: input.pattern, include, matches, truncated }
        }
      }
    }

    await context.metadata({
      toolName: 'grep',
      status: 'completed',
      summary: `Found ${matches.length} match${matches.length === 1 ? '' : 'es'}`,
    })
    return { pattern: input.pattern, include, matches, truncated }
  },
}
