import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createPtySessionManager, type PtyOutputChunk } from './adapters/pty'

let workspaceRoot: string

beforeEach(async () => {
  workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'specter-code-pty-'))
  await mkdir(path.join(workspaceRoot, 'src'), { recursive: true })
})

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true })
})

const waitFor = async (predicate: () => boolean, timeoutMs = 2000) => {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('Timed out waiting for PTY output')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('PTY session manager', () => {
  it('starts an interactive shell inside a workspace subdirectory and streams input output until exit', async () => {
    const chunks: PtyOutputChunk[] = []
    const exits: Array<{ exitCode: number | null; signal: NodeJS.Signals | null }> = []
    const manager = createPtySessionManager({
      onOutput: (chunk) => chunks.push(chunk),
      onExit: (exit) => exits.push({ exitCode: exit.exitCode, signal: exit.signal }),
    })

    const session = await manager.start({
      sessionId: 'session-pty-1',
      workspaceRoot,
      cwd: 'src',
      shell: '/bin/sh',
    })

    expect(session).toMatchObject({
      id: expect.any(String),
      sessionId: 'session-pty-1',
      cwd: 'src',
      shell: '/bin/sh',
      status: 'running',
    })

    manager.write(session.id, 'printf "cwd=$(pwd)\\n"\nexit\n')
    await waitFor(() => chunks.some((chunk) => chunk.data.includes('cwd=')))
    const closed = await manager.waitForExit(session.id)

    expect(closed.status).toBe('exited')
    expect(exits).toEqual([{ exitCode: 0, signal: null }])
    expect(chunks.map((chunk) => chunk.data).join('')).toContain(path.join(workspaceRoot, 'src'))
    expect(manager.list()).toEqual([])
  })

  it('rejects workspace escape and symlink cwd before spawning a process', async () => {
    await symlink(path.dirname(workspaceRoot), path.join(workspaceRoot, 'outside-link'), 'dir')
    const manager = createPtySessionManager()

    await expect(
      manager.start({ sessionId: 'session-pty-escape', workspaceRoot, cwd: '..', shell: '/bin/sh' }),
    ).rejects.toThrow('Shell working directory escapes the workspace root')
    await expect(
      manager.start({
        sessionId: 'session-pty-link',
        workspaceRoot,
        cwd: 'outside-link',
        shell: '/bin/sh',
      }),
    ).rejects.toThrow('Shell working directory must not traverse symlinks')
    expect(manager.list()).toEqual([])
  })
})
