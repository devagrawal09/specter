import { spawn } from 'node:child_process'
import { lstat } from 'node:fs/promises'
import path from 'node:path'

import { normalizeWorkspacePath } from './file-index'

export type ShellOutputStream = 'stdout' | 'stderr'

export type ShellOutputChunk = {
  stream: ShellOutputStream
  chunk: string
}

export type ShellWorkingDirectory = {
  path: string
  absolutePath: string
}

export type ShellRunInput = {
  command: string
  cwd: string
  shell?: string
  timeoutMs?: number
  maxOutputBytes?: number
}

export type ShellRunOptions = {
  abortSignal?: AbortSignal
  onOutput?: (chunk: ShellOutputChunk) => void
}

export type ShellRunResult = {
  stdout: string
  stderr: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  truncated: boolean
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024

const isInsideRoot = (root: string, candidate: string) => {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(resolvedRoot + path.sep)
}

const normalizeShellCwd = (cwd: string | undefined) => {
  const trimmed = cwd?.trim() ?? ''
  if (!trimmed || trimmed === '.') return '.'

  try {
    return normalizeWorkspacePath(trimmed)
  } catch (error) {
    if (error instanceof Error && error.message.includes('escapes the workspace root')) {
      throw new Error('Shell working directory escapes the workspace root')
    }
    throw error
  }
}

export async function resolveShellWorkingDirectory(
  workspaceRoot: string,
  cwd?: string,
): Promise<ShellWorkingDirectory> {
  const root = path.resolve(workspaceRoot)
  const rootStat = await lstat(root)
  if (rootStat.isSymbolicLink()) throw new Error('Workspace root must not be a symlink')
  if (!rootStat.isDirectory()) throw new Error('Workspace root must be a directory')

  const relativePath = normalizeShellCwd(cwd)
  if (relativePath === '.') return { path: '.', absolutePath: root }

  let current = root
  for (const segment of relativePath.split('/')) {
    current = path.join(current, segment)
    if (!isInsideRoot(root, current)) {
      throw new Error('Shell working directory escapes the workspace root')
    }

    const stat = await lstat(current)
    if (stat.isSymbolicLink()) {
      throw new Error('Shell working directory must not traverse symlinks')
    }
    if (!stat.isDirectory()) {
      throw new Error('Shell working directory must be a directory')
    }
  }

  return { path: relativePath, absolutePath: current }
}

type OutputState = {
  stdout: string
  stderr: string
  usedBytes: number
  truncated: boolean
}

const normalizePositiveInteger = (value: number | undefined, fallback: number) => {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value <= 0) throw new Error('Shell limits must be positive numbers')
  return Math.floor(value)
}

const appendBoundedOutput = (
  state: OutputState,
  stream: ShellOutputStream,
  chunk: Buffer,
  maxOutputBytes: number,
) => {
  const remainingBytes = maxOutputBytes - state.usedBytes
  if (remainingBytes <= 0) {
    state.truncated = true
    return ''
  }

  const accepted = chunk.byteLength > remainingBytes ? chunk.subarray(0, remainingBytes) : chunk
  state.usedBytes += accepted.byteLength
  if (accepted.byteLength < chunk.byteLength) state.truncated = true

  const acceptedText = accepted.toString('utf8')
  state[stream] += acceptedText
  return acceptedText
}

export async function runShellCommand(
  input: ShellRunInput,
  options: ShellRunOptions = {},
): Promise<ShellRunResult> {
  const command = input.command.trim()
  if (!command) throw new Error('Shell command is required')

  const timeoutMs = normalizePositiveInteger(input.timeoutMs, DEFAULT_TIMEOUT_MS)
  const maxOutputBytes = normalizePositiveInteger(input.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES)
  const output: OutputState = { stdout: '', stderr: '', usedBytes: 0, truncated: false }

  return await new Promise<ShellRunResult>((resolve, reject) => {
    const child = spawn(command, {
      cwd: input.cwd,
      shell: input.shell ?? true,
      windowsHide: true,
      detached: process.platform !== 'win32',
    })

    let timedOut = false
    let aborted = false
    let settled = false
    let killTimer: NodeJS.Timeout | undefined

    const cleanup = () => {
      clearTimeout(timeout)
      if (killTimer) clearTimeout(killTimer)
      options.abortSignal?.removeEventListener('abort', abort)
    }

    const killChild = (signal: NodeJS.Signals) => {
      if (process.platform !== 'win32' && child.pid) {
        try {
          process.kill(-child.pid, signal)
          return
        } catch {
          // Fall back to killing the shell process itself below.
        }
      }
      child.kill(signal)
    }

    const terminate = () => {
      killChild('SIGTERM')
      killTimer = setTimeout(() => {
        killChild('SIGKILL')
      }, 1_000)
    }

    const abort = () => {
      aborted = true
      terminate()
    }

    const timeout = setTimeout(() => {
      timedOut = true
      terminate()
    }, timeoutMs)

    if (options.abortSignal?.aborted) abort()
    options.abortSignal?.addEventListener('abort', abort, { once: true })

    child.stdout.on('data', (chunk: Buffer) => {
      const accepted = appendBoundedOutput(output, 'stdout', chunk, maxOutputBytes)
      if (accepted) options.onOutput?.({ stream: 'stdout', chunk: accepted })
    })

    child.stderr.on('data', (chunk: Buffer) => {
      const accepted = appendBoundedOutput(output, 'stderr', chunk, maxOutputBytes)
      if (accepted) options.onOutput?.({ stream: 'stderr', chunk: accepted })
    })

    child.on('error', (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    })

    child.on('close', (exitCode, signal) => {
      if (settled) return
      settled = true
      cleanup()
      if (aborted && !timedOut) {
        reject(new Error('Shell command aborted'))
        return
      }
      resolve({
        stdout: output.stdout,
        stderr: output.stderr,
        exitCode,
        signal,
        timedOut,
        truncated: output.truncated,
      })
    })
  })
}
