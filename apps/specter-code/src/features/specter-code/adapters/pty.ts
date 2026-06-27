import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'

import { resolveShellWorkingDirectory } from './shell.ts'

export type PtySessionStatus = 'running' | 'exited' | 'killed'

export type PtySession = {
  id: string
  sessionId: string
  cwd: string
  absoluteCwd: string
  shell: string
  status: PtySessionStatus
  startedAt: string
  endedAt?: string
}

export type PtyOutputChunk = {
  ptySessionId: string
  sessionId: string
  stream: 'stdout' | 'stderr'
  data: string
  sequence: number
  emittedAt: string
}

export type PtyExit = {
  ptySessionId: string
  sessionId: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  status: Exclude<PtySessionStatus, 'running'>
  endedAt: string
}

export type PtyStartInput = {
  sessionId: string
  workspaceRoot: string
  cwd?: string
  shell?: string
}

export type PtySessionManagerOptions = {
  onOutput?: (chunk: PtyOutputChunk) => void
  onExit?: (exit: PtyExit) => void
}

type PtyRecord = PtySession & {
  child: ChildProcessWithoutNullStreams
  exitPromise: Promise<PtySession>
  resolveExit: (session: PtySession) => void
  sequence: number
}

export class PtySessionManager {
  readonly #sessions = new Map<string, PtyRecord>()

  constructor(private readonly options: PtySessionManagerOptions = {}) {}

  async start(input: PtyStartInput): Promise<PtySession> {
    const cwd = await resolveShellWorkingDirectory(input.workspaceRoot, input.cwd)
    const shell = input.shell ?? process.env.SHELL ?? '/bin/sh'
    const child = spawn(shell, [], {
      cwd: cwd.absolutePath,
      env: process.env,
      windowsHide: true,
    })

    let resolveExit: (session: PtySession) => void = () => {}
    const exitPromise = new Promise<PtySession>((resolve) => {
      resolveExit = resolve
    })

    const record: PtyRecord = {
      id: randomUUID(),
      sessionId: input.sessionId,
      cwd: cwd.path,
      absoluteCwd: cwd.absolutePath,
      shell,
      status: 'running',
      startedAt: new Date().toISOString(),
      child,
      exitPromise,
      resolveExit,
      sequence: 0,
    }

    child.stdout.on('data', (chunk: Buffer) => this.#emitOutput(record, 'stdout', chunk))
    child.stderr.on('data', (chunk: Buffer) => this.#emitOutput(record, 'stderr', chunk))
    child.on('error', (error) => this.#emitOutput(record, 'stderr', Buffer.from(error.message)))
    child.on('close', (exitCode, signal) => {
      if (record.status !== 'running') return
      const endedAt = new Date().toISOString()
      record.status = signal ? 'killed' : 'exited'
      record.endedAt = endedAt
      const exit: PtyExit = {
        ptySessionId: record.id,
        sessionId: record.sessionId,
        exitCode,
        signal,
        status: record.status,
        endedAt,
      }
      this.options.onExit?.(exit)
      record.resolveExit(toPublicSession(record))
    })

    this.#sessions.set(record.id, record)
    return toPublicSession(record)
  }

  list(): PtySession[] {
    return [...this.#sessions.values()]
      .filter((session) => session.status === 'running')
      .map(toPublicSession)
  }

  write(ptySessionId: string, data: string) {
    const session = this.#get(ptySessionId)
    if (session.status !== 'running') throw new Error('PTY session is not running')
    session.child.stdin.write(data)
  }

  async stop(ptySessionId: string): Promise<PtySession> {
    const session = this.#get(ptySessionId)
    if (session.status === 'running') session.child.kill('SIGTERM')
    return await this.waitForExit(ptySessionId)
  }

  async waitForExit(ptySessionId: string): Promise<PtySession> {
    const session = this.#get(ptySessionId)
    const closed = await session.exitPromise
    this.#sessions.delete(ptySessionId)
    return closed
  }

  #get(ptySessionId: string) {
    const session = this.#sessions.get(ptySessionId)
    if (!session) throw new Error('Unknown PTY session: ' + ptySessionId)
    return session
  }

  #emitOutput(record: PtyRecord, stream: 'stdout' | 'stderr', chunk: Buffer) {
    const data = chunk.toString('utf8')
    if (!data) return
    record.sequence += 1
    this.options.onOutput?.({
      ptySessionId: record.id,
      sessionId: record.sessionId,
      stream,
      data,
      sequence: record.sequence,
      emittedAt: new Date().toISOString(),
    })
  }
}

const toPublicSession = (record: PtyRecord): PtySession => ({
  id: record.id,
  sessionId: record.sessionId,
  cwd: record.cwd,
  absoluteCwd: record.absoluteCwd,
  shell: record.shell,
  status: record.status,
  startedAt: record.startedAt,
  endedAt: record.endedAt,
})

export function createPtySessionManager(options: PtySessionManagerOptions = {}) {
  return new PtySessionManager(options)
}
