import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  PermissionAction,
  PermissionRequest,
} from './adapters/permissions'
import { createToolRegistry, type ToolContext } from './adapters/tool-registry'
import { shellTool } from './tools/shell'

let workspaceRoot: string

const createContext = (overrides: Partial<ToolContext> = {}): ToolContext => ({
  sessionId: 'session-shell-1',
  messageId: 'message-shell-1',
  agent: 'build',
  workspaceRoot,
  abortSignal: new AbortController().signal,
  ask: vi.fn(async () => 'allow' as PermissionAction),
  metadata: vi.fn(),
  ...overrides,
})

beforeEach(async () => {
  workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), 'specter-code-shell-tools-'),
  )
  await mkdir(path.join(workspaceRoot, 'src'), { recursive: true })
})

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true })
})

describe('shell tool', () => {
  it('runs an approved command inside a workspace subdirectory and streams output metadata', async () => {
    const ask = vi.fn(
      async (_request: PermissionRequest) => 'allow' as PermissionAction,
    )
    const context = createContext({ ask })
    const registry = createToolRegistry()
    registry.register(shellTool)

    await expect(
      registry.execute(
        'shell',
        {
          command: 'printf hello; printf warn >&2',
          cwd: 'src',
          timeoutMs: 1000,
          maxOutputBytes: 1000,
        },
        context,
      ),
    ).resolves.toEqual({
      command: 'printf hello; printf warn >&2',
      cwd: 'src',
      stdout: 'hello',
      stderr: 'warn',
      exitCode: 0,
      signal: null,
      timedOut: false,
      truncated: false,
    })

    expect(ask).toHaveBeenCalledWith({
      permission: 'shell.execute',
      target: 'printf hello; printf warn >&2',
    })
    expect(context.metadata).toHaveBeenCalledWith({
      toolName: 'shell',
      status: 'started',
      summary: 'Running printf hello; printf warn >&2',
    })
    expect(context.metadata).toHaveBeenCalledWith({
      toolName: 'shell',
      status: 'output',
      stream: 'stdout',
      summary: 'hello',
    })
    expect(context.metadata).toHaveBeenCalledWith({
      toolName: 'shell',
      status: 'output',
      stream: 'stderr',
      summary: 'warn',
    })
    expect(context.metadata).toHaveBeenCalledWith({
      toolName: 'shell',
      status: 'completed',
      summary: 'Shell exited 0',
    })
  })

  it('honors allow permission rules through the registry without prompting', async () => {
    const ask = vi.fn(
      async (_request: PermissionRequest) => 'deny' as PermissionAction,
    )
    const context = createContext({
      ask,
      permissionRules: [
        {
          permission: 'shell.execute',
          pattern: 'printf rule-ok',
          action: 'allow',
        },
      ],
    })
    const registry = createToolRegistry()
    registry.register(shellTool)

    await expect(
      registry.execute(
        'shell',
        { command: 'printf rule-ok', timeoutMs: 1000 },
        context,
      ),
    ).resolves.toMatchObject({
      stdout: 'rule-ok',
      exitCode: 0,
      timedOut: false,
    })
    expect(ask).not.toHaveBeenCalled()
  })

  it('honors deny permission rules through the registry without running the command', async () => {
    const ask = vi.fn(
      async (_request: PermissionRequest) => 'allow' as PermissionAction,
    )
    const context = createContext({
      ask,
      permissionRules: [
        {
          permission: 'shell.execute',
          pattern: 'printf denied > src/denied.txt',
          action: 'deny',
        },
      ],
    })
    const registry = createToolRegistry()
    registry.register(shellTool)

    await expect(
      registry.execute(
        'shell',
        { command: 'printf denied > src/denied.txt', timeoutMs: 1000 },
        context,
      ),
    ).rejects.toThrow('Tool denied: shell for printf denied > src/denied.txt')
    expect(ask).not.toHaveBeenCalled()
    await expect(
      readFile(path.join(workspaceRoot, 'src', 'denied.txt'), 'utf8'),
    ).rejects.toThrow()
  })

  it('blocks shell working directory escapes before asking for approval', async () => {
    const ask = vi.fn(
      async (_request: PermissionRequest) => 'allow' as PermissionAction,
    )
    const context = createContext({ ask })

    await expect(
      shellTool.execute({ command: 'pwd', cwd: '..' }, context),
    ).rejects.toThrow('Shell working directory escapes the workspace root')
    expect(ask).not.toHaveBeenCalled()
  })

  it('marks shell output truncated when the max output budget is reached', async () => {
    const context = createContext()

    await expect(
      shellTool.execute(
        { command: 'printf abcdef', maxOutputBytes: 3 },
        context,
      ),
    ).resolves.toMatchObject({
      stdout: 'abc',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      truncated: true,
    })
  })

  it('terminates commands that exceed the configured timeout', async () => {
    const context = createContext()

    await expect(
      shellTool.execute(
        { command: 'node -e "setTimeout(() => {}, 1000)"', timeoutMs: 50 },
        context,
      ),
    ).resolves.toMatchObject({
      stdout: '',
      stderr: '',
      exitCode: null,
      timedOut: true,
      truncated: false,
    })
  })
})
