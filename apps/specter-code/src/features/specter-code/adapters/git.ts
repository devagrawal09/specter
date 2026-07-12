import { spawn } from 'node:child_process'
import { lstat } from 'node:fs/promises'
import path from 'node:path'

export type GitStatusEntry = {
  path: string
  index: string
  workingTree: string
  originalPath?: string
}

export type GitStatus = {
  branch?: string
  clean: boolean
  entries: GitStatusEntry[]
}

export type GitDiff = {
  patch: string
  staged: boolean
  path?: string
}

const GIT_TIMEOUT_MS = 30_000
const GIT_MAX_BUFFER = 10 * 1024 * 1024

function normalizeSlashes(input: string) {
  return input.replaceAll('\\', '/')
}

function isWindowsAbsolutePath(input: string) {
  return /^[a-zA-Z]:[\\/]/.test(input)
}

function normalizeWorkspacePath(input: string, errorMessage = 'Git path escapes the workspace root') {
  const slashNormalized = normalizeSlashes(input.trim())
  if (!slashNormalized) throw new Error('Git path is required')
  if (path.posix.isAbsolute(slashNormalized) || isWindowsAbsolutePath(slashNormalized)) {
    throw new Error(errorMessage)
  }

  const normalized = path.posix.normalize(slashNormalized)
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(errorMessage)
  }
  return normalized
}

async function assertWorkspaceRoot(workspaceRoot: string) {
  const resolved = path.resolve(workspaceRoot)
  const stat = await lstat(resolved)
  if (stat.isSymbolicLink()) throw new Error('Git workspace root must not be a symlink')
  if (!stat.isDirectory()) throw new Error('Git workspace root must be a directory')
  return resolved
}

async function runGit(input: { workspaceRoot: string; args: string[]; stdin?: string }) {
  const cwd = await assertWorkspaceRoot(input.workspaceRoot)

  return new Promise<string>((resolve, reject) => {
    const child = spawn('git', input.args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let stderrBytes = 0

    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`git ${input.args.join(' ')} timed out`))
    }, GIT_TIMEOUT_MS)

    const collect = (label: 'stdout' | 'stderr') => (chunk: Buffer) => {
      if (label === 'stdout') stdoutBytes += chunk.byteLength
      else stderrBytes += chunk.byteLength
      if (stdoutBytes + stderrBytes > GIT_MAX_BUFFER) {
        child.kill('SIGTERM')
        reject(new Error(`git ${input.args.join(' ')} exceeded output limit`))
        return
      }
      if (label === 'stdout') stdout += chunk.toString('utf8')
      else stderr += chunk.toString('utf8')
    }

    child.stdout.on('data', collect('stdout'))
    child.stderr.on('data', collect('stderr'))
    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timeout)
      const trimmedStderr = stderr.trim()
      if (code === 0) {
        resolve(stdout)
        return
      }
      reject(
        new Error(
          trimmedStderr ||
            `git ${input.args.join(' ')} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`,
        ),
      )
    })

    if (input.stdin !== undefined) child.stdin.end(input.stdin)
    else child.stdin.end()
  })
}

function parseBranch(line: string) {
  const branchText = line.slice(3).trim()
  if (!branchText || branchText === 'HEAD (no branch)') return undefined
  return branchText.split(/[. ]/)[0]
}

function parseStatusEntry(line: string): GitStatusEntry | undefined {
  if (line.startsWith('## ')) return undefined
  if (line.length < 3) return undefined

  const index = line[0]
  const workingTree = line[1]
  const rawPath = line.slice(3).trim()
  if (!rawPath) return undefined

  if ((index === 'R' || index === 'C') && rawPath.includes(' -> ')) {
    const [originalPath, nextPath] = rawPath.split(' -> ')
    return { path: nextPath, originalPath, index, workingTree }
  }

  return { path: rawPath, index, workingTree }
}

export async function initGitRepository(input: { workspaceRoot: string }): Promise<{ workspaceRoot: string }> {
  const workspaceRoot = await assertWorkspaceRoot(input.workspaceRoot)
  await runGit({ workspaceRoot, args: ['init'] })
  return { workspaceRoot }
}

export async function getGitStatus(input: { workspaceRoot: string }): Promise<GitStatus> {
  const stdout = await runGit({
    workspaceRoot: input.workspaceRoot,
    args: ['status', '--porcelain=v1', '--branch'],
  })
  const lines = stdout.split(/\r?\n/).filter(Boolean)
  const branch = lines.find((line) => line.startsWith('## '))
  const entries = lines
    .map(parseStatusEntry)
    .filter((entry): entry is GitStatusEntry => entry !== undefined)

  return {
    branch: branch ? parseBranch(branch) : undefined,
    clean: entries.length === 0,
    entries,
  }
}

export async function getGitDiff(input: {
  workspaceRoot: string
  path?: string
  staged?: boolean
}): Promise<GitDiff> {
  const args = ['diff']
  if (input.staged) args.push('--staged')
  const normalizedPath = input.path ? normalizeWorkspacePath(input.path) : undefined
  if (normalizedPath) args.push('--', normalizedPath)

  return {
    patch: await runGit({ workspaceRoot: input.workspaceRoot, args }),
    staged: input.staged ?? false,
    path: normalizedPath,
  }
}

function normalizePatchFilePath(rawPath: string) {
  const trimmed = rawPath.trim()
  if (!trimmed || trimmed === '/dev/null') return undefined
  const withoutPrefix = trimmed.startsWith('a/') || trimmed.startsWith('b/') ? trimmed.slice(2) : trimmed
  return normalizeWorkspacePath(withoutPrefix, 'Git patch path escapes the workspace root')
}

function extractPatchPaths(patchText: string) {
  const paths = new Set<string>()
  for (const line of patchText.split(/\r?\n/)) {
    if (!line.startsWith('--- ') && !line.startsWith('+++ ')) continue
    const rawPath = line.slice(4).split(/\t/)[0]
    const normalized = normalizePatchFilePath(rawPath)
    if (normalized) paths.add(normalized)
  }
  return [...paths].sort()
}

export async function applyGitPatch(input: {
  workspaceRoot: string
  patch: string
  staged?: boolean
}): Promise<{ paths: string[]; staged: boolean }> {
  if (!input.patch.trim()) throw new Error('Git patch is required')
  const paths = extractPatchPaths(input.patch)
  if (paths.length === 0) throw new Error('Git patch does not reference any workspace files')

  await runGit({
    workspaceRoot: input.workspaceRoot,
    args: ['apply', '--whitespace=nowarn', ...(input.staged ? ['--index'] : [])],
    stdin: input.patch,
  })

  return { paths, staged: input.staged ?? false }
}

export async function revertWorkspacePaths(input: {
  workspaceRoot: string
  paths: string[]
}): Promise<{ paths: string[] }> {
  const seen = new Set<string>()
  const normalizedPaths = input.paths
    .map((pathInput) => normalizeWorkspacePath(pathInput))
    .filter((pathInput) => {
      if (seen.has(pathInput)) return false
      seen.add(pathInput)
      return true
    })
  if (normalizedPaths.length === 0) throw new Error('At least one Git path is required')

  for (const normalizedPath of normalizedPaths) {
    await runGit({
      workspaceRoot: input.workspaceRoot,
      args: ['checkout', '--', normalizedPath],
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes('pathspec')) throw error
    })
  }

  await runGit({
    workspaceRoot: input.workspaceRoot,
    args: ['clean', '-f', '--', ...normalizedPaths],
  })

  return { paths: normalizedPaths }
}
