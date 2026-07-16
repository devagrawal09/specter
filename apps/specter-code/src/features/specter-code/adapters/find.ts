import { lstat, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import {
  listWorkspaceFiles,
  matchesWorkspaceGlob,
  normalizeWorkspacePath,
  resolveWorkspacePath,
} from './file-index.ts'

export type FindWorkspaceFilesInput = {
  workspaceRoot: string
  directory?: string
  query: string
  limit?: number
  type?: 'file' | 'directory'
}

export type FindWorkspaceTextInput = {
  workspaceRoot: string
  directory?: string
  pattern: string
  limit?: number
  caseSensitive?: boolean
}

export type OpenCodeTextMatch = {
  path: { text: string }
  lines: { text: string }
  line_number: number
  absolute_offset: number
  submatches: Array<{
    match: { text: string }
    start: number
    end: number
  }>
}

const DEFAULT_FILE_LIMIT = 50
const MAX_FILE_LIMIT = 200
const DEFAULT_TEXT_LIMIT = 100
const MAX_TEXT_LIMIT = 1_000
const MAX_SEARCH_BYTES_PER_FILE = 1_000_000
const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  '.turbo',
  '.vite',
  '.next',
])

function normalizeLimit(
  value: number | undefined,
  fallback: number,
  maximum: number,
  label: string,
) {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value < 1)
    throw new Error(label + ' must be positive')
  return Math.min(Math.floor(value), maximum)
}

function isGlobQuery(query: string) {
  return /[*?{[]/.test(query)
}

function containsNullByte(buffer: Buffer) {
  return buffer.includes(0)
}

async function resolveSearchRoot(workspaceRoot: string, directory?: string) {
  if (!directory || directory.trim() === '.' || directory.trim() === '') {
    return { root: path.resolve(workspaceRoot), prefix: '' }
  }

  const resolved = await resolveWorkspacePath(workspaceRoot, directory)
  if (!resolved.stat.isDirectory())
    throw new Error('Find directory must be a directory')
  return {
    root: resolved.absolutePath,
    prefix: normalizeWorkspacePath(directory),
  }
}

function fileMatchesQuery(filePath: string, query: string) {
  const normalizedQuery = query.trim().replaceAll('\\', '/')
  if (!normalizedQuery) throw new Error('Find query is required')
  if (isGlobQuery(normalizedQuery))
    return matchesWorkspaceGlob(normalizedQuery, filePath)
  return filePath.toLowerCase().includes(normalizedQuery.toLowerCase())
}
function isInsideRoot(root: string, candidate: string) {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(resolvedRoot + path.sep)
  )
}

async function listWorkspaceDirectories(
  workspaceRoot: string,
): Promise<string[]> {
  const root = path.resolve(workspaceRoot)
  const rootStat = await lstat(root)
  if (rootStat.isSymbolicLink())
    throw new Error('Workspace root must not be a symlink')
  if (!rootStat.isDirectory())
    throw new Error('Workspace root must be a directory')

  const directories: string[] = []
  const walk = async (
    absoluteDirectory: string,
    relativeDirectory: string | null,
  ) => {
    const entries = await readdir(absoluteDirectory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of entries) {
      if (!entry.isDirectory() || IGNORED_DIRECTORIES.has(entry.name)) continue
      const absolutePath = path.join(absoluteDirectory, entry.name)
      if (!isInsideRoot(root, absolutePath)) continue
      const stat = await lstat(absolutePath)
      if (stat.isSymbolicLink() || !stat.isDirectory()) continue
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name
      const normalizedPath = normalizeWorkspacePath(relativePath)
      directories.push(normalizedPath)
      await walk(absolutePath, normalizedPath)
    }
  }

  await walk(root, null)
  return directories.sort((left, right) => left.localeCompare(right))
}

function createGlobalExpression(
  pattern: string,
  caseSensitive: boolean | undefined,
) {
  if (!pattern.trim()) throw new Error('Find pattern is required')
  const flags = caseSensitive === false ? 'gi' : 'g'
  return new RegExp(pattern, flags)
}

export async function findWorkspaceFiles(
  input: FindWorkspaceFilesInput,
): Promise<string[]> {
  const { root } = await resolveSearchRoot(input.workspaceRoot, input.directory)
  const limit = normalizeLimit(
    input.limit,
    DEFAULT_FILE_LIMIT,
    MAX_FILE_LIMIT,
    'Find file limit',
  )
  const entries =
    input.type === 'directory'
      ? await listWorkspaceDirectories(root)
      : (await listWorkspaceFiles(root)).map((file) => file.path)
  return entries
    .filter((filePath) => fileMatchesQuery(filePath, input.query))
    .slice(0, limit)
}

export async function findWorkspaceText(
  input: FindWorkspaceTextInput,
): Promise<OpenCodeTextMatch[]> {
  const { root } = await resolveSearchRoot(input.workspaceRoot, input.directory)
  const limit = normalizeLimit(
    input.limit,
    DEFAULT_TEXT_LIMIT,
    MAX_TEXT_LIMIT,
    'Find text limit',
  )
  const expression = createGlobalExpression(input.pattern, input.caseSensitive)
  const matches: OpenCodeTextMatch[] = []

  for (const file of await listWorkspaceFiles(root)) {
    if (file.sizeBytes > MAX_SEARCH_BYTES_PER_FILE) continue
    const buffer = await readFile(file.absolutePath)
    if (containsNullByte(buffer)) continue

    const content = buffer.toString('utf8')
    let absoluteOffset = 0
    const lines = content.split(/(\r?\n)/)
    for (
      let index = 0, lineNumber = 1;
      index < lines.length;
      index += 2, lineNumber += 1
    ) {
      const line = lines[index] ?? ''
      expression.lastIndex = 0
      const submatches = [...line.matchAll(expression)].map((match) => ({
        match: { text: match[0] },
        start: match.index,
        end: match.index + match[0].length,
      }))
      if (submatches.length) {
        matches.push({
          path: { text: file.path },
          lines: { text: line },
          line_number: lineNumber,
          absolute_offset: absoluteOffset,
          submatches,
        })
        if (matches.length >= limit) return matches
      }
      absoluteOffset += Buffer.byteLength(
        line + (lines[index + 1] ?? ''),
        'utf8',
      )
    }
  }

  return matches
}
