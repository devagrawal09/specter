import type { Stats } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  '.turbo',
  '.vite',
  '.next',
])

const REGEXP_SPECIAL_CHARACTERS = new Set([
  '\\',
  '.',
  '+',
  '?',
  '^',
  '$',
  '{',
  '}',
  '(',
  ')',
  '|',
  '[',
  ']',
])

export type WorkspaceResolvedPath = {
  path: string
  absolutePath: string
  stat: Stats
}

export type WorkspaceFileEntry = {
  path: string
  absolutePath: string
  sizeBytes: number
}

const escapeRegExpCharacter = (character: string) =>
  REGEXP_SPECIAL_CHARACTERS.has(character) ? `\\${character}` : character

const isWindowsAbsolutePath = (value: string) => /^[a-zA-Z]:\//.test(value)

const isInsideRoot = (root: string, candidate: string) => {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
  )
}

const normalizeSlashes = (input: string) => input.trim().replaceAll('\\', '/')

export const normalizeWorkspacePath = (input: string): string => {
  const slashNormalized = normalizeSlashes(input)
  if (!slashNormalized) throw new Error('Workspace path is required')
  if (
    path.posix.isAbsolute(slashNormalized) ||
    isWindowsAbsolutePath(slashNormalized)
  ) {
    throw new Error('Workspace path escapes the workspace root')
  }

  const normalized = path.posix.normalize(slashNormalized)
  if (
    normalized === '.' ||
    normalized.startsWith('../') ||
    normalized === '..'
  ) {
    throw new Error('Workspace path escapes the workspace root')
  }

  return normalized
}

export const normalizeWorkspaceGlobPattern = (
  input: string | undefined,
): string => {
  const slashNormalized = normalizeSlashes(input ?? '**/*')
  if (!slashNormalized) throw new Error('Workspace glob pattern is required')
  if (
    path.posix.isAbsolute(slashNormalized) ||
    isWindowsAbsolutePath(slashNormalized)
  ) {
    throw new Error('Workspace glob pattern escapes the workspace root')
  }
  if (slashNormalized.split('/').some((segment) => segment === '..')) {
    throw new Error('Workspace glob pattern escapes the workspace root')
  }
  return slashNormalized === '.' ? '**/*' : slashNormalized.replace(/^\.\//, '')
}

export const resolveWorkspacePath = async (
  workspaceRoot: string,
  input: string,
): Promise<WorkspaceResolvedPath> => {
  const relativePath = normalizeWorkspacePath(input)
  const root = path.resolve(workspaceRoot)
  const rootStat = await lstat(root)
  if (rootStat.isSymbolicLink())
    throw new Error('Workspace root must not be a symlink')
  if (!rootStat.isDirectory())
    throw new Error('Workspace root must be a directory')

  let current = root
  let currentStat: Stats = rootStat
  for (const segment of relativePath.split('/')) {
    current = path.join(current, segment)
    if (!isInsideRoot(root, current)) {
      throw new Error('Workspace path escapes the workspace root')
    }
    currentStat = await lstat(current)
    if (currentStat.isSymbolicLink()) {
      throw new Error('Workspace path must not traverse symlinks')
    }
  }

  return { path: relativePath, absolutePath: current, stat: currentStat }
}

export const resolveWorkspaceFile = async (
  workspaceRoot: string,
  input: string,
): Promise<WorkspaceResolvedPath> => {
  const resolved = await resolveWorkspacePath(workspaceRoot, input)
  if (!resolved.stat.isFile()) throw new Error('Workspace path must be a file')
  return resolved
}

const segmentPatternToRegExp = (segment: string) => {
  let expression = ''
  for (let index = 0; index < segment.length; index += 1) {
    const character = segment[index]
    if (character === '*') {
      expression += '[^/]*'
      continue
    }
    if (character === '?') {
      expression += '[^/]'
      continue
    }
    if (character === '{') {
      const closeIndex = segment.indexOf('}', index + 1)
      if (closeIndex > index + 1) {
        const alternatives = segment
          .slice(index + 1, closeIndex)
          .split(',')
          .map((alternative) =>
            alternative.split('').map(escapeRegExpCharacter).join(''),
          )
        expression += `(?:${alternatives.join('|')})`
        index = closeIndex
        continue
      }
    }
    expression += escapeRegExpCharacter(character)
  }
  return new RegExp(`^${expression}$`)
}

const matchSegments = (
  patternSegments: readonly string[],
  pathSegments: readonly string[],
): boolean => {
  const matchFrom = (patternIndex: number, pathIndex: number): boolean => {
    if (patternIndex === patternSegments.length)
      return pathIndex === pathSegments.length

    const patternSegment = patternSegments[patternIndex]
    if (patternSegment === '**') {
      for (
        let nextPathIndex = pathIndex;
        nextPathIndex <= pathSegments.length;
        nextPathIndex += 1
      ) {
        if (matchFrom(patternIndex + 1, nextPathIndex)) return true
      }
      return false
    }

    if (pathIndex >= pathSegments.length) return false
    return (
      segmentPatternToRegExp(patternSegment).test(pathSegments[pathIndex]) &&
      matchFrom(patternIndex + 1, pathIndex + 1)
    )
  }

  return matchFrom(0, 0)
}

export const matchesWorkspaceGlob = (pattern: string, value: string) => {
  const normalizedPattern = normalizeWorkspaceGlobPattern(pattern)
  const normalizedValue = normalizeWorkspacePath(value)
  return matchSegments(normalizedPattern.split('/'), normalizedValue.split('/'))
}

export const listWorkspaceFiles = async (
  workspaceRoot: string,
): Promise<WorkspaceFileEntry[]> => {
  const root = path.resolve(workspaceRoot)
  const rootStat = await lstat(root)
  if (rootStat.isSymbolicLink())
    throw new Error('Workspace root must not be a symlink')
  if (!rootStat.isDirectory())
    throw new Error('Workspace root must be a directory')

  const files: WorkspaceFileEntry[] = []

  const walk = async (
    absoluteDirectory: string,
    relativeDirectory: string | null,
  ) => {
    const entries = await readdir(absoluteDirectory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of entries) {
      if (entry.isDirectory() && DEFAULT_IGNORED_DIRECTORIES.has(entry.name))
        continue
      const absolutePath = path.join(absoluteDirectory, entry.name)
      if (!isInsideRoot(root, absolutePath)) continue
      const stat = await lstat(absolutePath)
      if (stat.isSymbolicLink()) continue
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name
      const normalizedPath = normalizeWorkspacePath(relativePath)
      if (stat.isDirectory()) {
        await walk(absolutePath, normalizedPath)
        continue
      }
      if (stat.isFile()) {
        files.push({ path: normalizedPath, absolutePath, sizeBytes: stat.size })
      }
    }
  }

  await walk(root, null)
  return files.sort((left, right) => left.path.localeCompare(right.path))
}
