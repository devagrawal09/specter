import { describe, expect, it, vi } from 'vitest'

import {
  ToolRegistry,
  type ToolContext,
  createToolRegistry,
} from './adapters/tool-registry'
import { evaluatePermission } from './adapters/permissions'

function createContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    sessionId: 'session-1',
    messageId: 'message-1',
    agent: 'build',
    workspaceRoot: '/workspace/project',
    abortSignal: new AbortController().signal,
    ask: async () => "allow" as const,
    metadata: vi.fn(),
    ...overrides,
  }
}

describe('ToolRegistry', () => {
  it('lists registered tools without exposing executable closures', () => {
    const registry = createToolRegistry()

    registry.register({
      name: 'read',
      description: 'Read a workspace file',
      permission: 'file.read',
      execute: async () => ({ content: 'hello' }),
    })

    expect(registry.list()).toEqual([
      {
        name: 'read',
        description: 'Read a workspace file',
        permission: 'file.read',
      },
    ])
  })

  it('executes a registered tool with the required OpenCode-style context', async () => {
    const registry = new ToolRegistry()
    const context = createContext()
    const execute = vi.fn(async (_input: { path: string }, ctx: ToolContext) => ({
      sessionId: ctx.sessionId,
      messageId: ctx.messageId,
      agent: ctx.agent,
      workspaceRoot: ctx.workspaceRoot,
    }))

    registry.register({
      name: 'read',
      permission: 'file.read',
      execute,
    })

    await expect(
      registry.execute('read', { path: 'README.md' }, context),
    ).resolves.toEqual({
      sessionId: 'session-1',
      messageId: 'message-1',
      agent: 'build',
      workspaceRoot: '/workspace/project',
    })
    expect(execute).toHaveBeenCalledWith({ path: 'README.md' }, context)
  })

  it('rejects duplicate tool names and unknown execution requests', async () => {
    const registry = createToolRegistry()
    registry.register({
      name: 'shell',
      permission: 'shell.execute',
      execute: async () => ({ ok: true }),
    })

    expect(() =>
      registry.register({
        name: 'shell',
        permission: 'shell.execute',
        execute: async () => ({ ok: true }),
      }),
    ).toThrow('Tool already registered: shell')

    await expect(
      registry.execute('missing', {}, createContext()),
    ).rejects.toThrow('Unknown tool: missing')
  })
})

describe('evaluatePermission', () => {
  it('defaults to ask when no rule matches', () => {
    expect(
      evaluatePermission([], { permission: 'file.write', target: 'src/app.ts' }),
    ).toEqual({ action: 'ask' })
  })

  it('uses the most recent matching wildcard rule', () => {
    expect(
      evaluatePermission(
        [
          { permission: 'file.write', pattern: 'src/**', action: 'allow' },
          { permission: 'file.write', pattern: 'src/secrets/**', action: 'deny' },
          { permission: 'file.*', pattern: 'src/secrets/example.env', action: 'ask' },
        ],
        { permission: 'file.write', target: 'src/secrets/example.env' },
      ),
    ).toEqual({
      action: 'ask',
      rule: {
        permission: 'file.*',
        pattern: 'src/secrets/example.env',
        action: 'ask',
      },
    })
  })

  it('matches shell command and file path patterns across slash styles', () => {
    expect(
      evaluatePermission(
        [
          { permission: 'shell.execute', pattern: 'pnpm --filter * test*', action: 'allow' },
          { permission: 'file.read', pattern: 'src/**/*.ts', action: 'allow' },
        ],
        { permission: 'shell.execute', target: 'pnpm --filter @specter/specter-code test' },
      ).action,
    ).toBe('allow')

    expect(
      evaluatePermission(
        [{ permission: 'file.read', pattern: 'src/**/*.ts', action: 'allow' }],
        { permission: "file.read", target: String.raw`src\features\specter-code\events.ts` },
      ).action,
    ).toBe('allow')
  })
})
