import { describe, expect, it, vi } from 'vitest'

import { createToolRegistry, type ToolContext } from './adapters/tool-registry'
import {
  createMcpClientRegistry,
  registerMcpTools,
  sanitizeMcpToolName,
  type McpClient,
} from './adapters/mcp'

const createContext = (overrides: Partial<ToolContext> = {}): ToolContext => ({
  sessionId: 'session-mcp-1',
  messageId: 'message-mcp-1',
  agent: 'build',
  workspaceRoot: '/workspace/project',
  abortSignal: new AbortController().signal,
  ask: vi.fn(async () => 'allow' as const),
  metadata: vi.fn(),
  ...overrides,
})

describe('MCP adapter and tool registry bridge', () => {
  it('sanitizes OpenCode-style server/tool names into registry-safe tool names', () => {
    expect(sanitizeMcpToolName('local-tools', 'repo/info')).toBe('local_tools_repo_info')
  })

  it('registers connected MCP tools and executes them through the ToolRegistry permission gate', async () => {
    const registry = createToolRegistry()
    const mcp = createMcpClientRegistry()
    const callTool = vi.fn(async ({ name, arguments: args }) => ({
      content: [{ type: 'text', text: `called ${name} on ${String(args?.path)}` }],
    }))
    const client: McpClient = {
      listTools: async () => [
        {
          name: 'repo/info',
          description: 'Describe a repository file',
          inputSchema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        },
      ],
      callTool,
    }
    mcp.connect('local-tools', client)

    await registerMcpTools(registry, mcp)

    expect(registry.list()).toEqual([
      {
        name: 'local_tools_repo_info',
        description: 'MCP local-tools: Describe a repository file',
        permission: 'mcp.local-tools.repo/info',
      },
    ])

    const context = createContext()
    await expect(
      registry.execute('local_tools_repo_info', { path: 'README.md' }, context),
    ).resolves.toEqual({
      server: 'local-tools',
      tool: 'repo/info',
      result: {
        content: [{ type: 'text', text: 'called repo/info on README.md' }],
      },
    })

    expect(context.ask).toHaveBeenCalledWith({
      permission: 'mcp.local-tools.repo/info',
      target: 'local-tools/repo/info',
    })
    expect(callTool).toHaveBeenCalledWith({
      name: 'repo/info',
      arguments: { path: 'README.md' },
    })
    expect(context.metadata).toHaveBeenCalledWith({
      toolName: 'local_tools_repo_info',
      status: 'completed',
      summary: 'Called MCP local-tools/repo/info',
    })
  })

  it('does not register disabled or failed MCP clients', async () => {
    const registry = createToolRegistry()
    const mcp = createMcpClientRegistry()
    mcp.connect('enabled', {
      listTools: async () => [{ name: 'echo', description: 'Echo input' }],
      callTool: async () => ({ content: [] }),
    })
    mcp.disable('disabled')
    mcp.fail('failed', new Error('connection refused'))

    await registerMcpTools(registry, mcp)

    expect(registry.list().map((tool) => tool.name)).toEqual(['enabled_echo'])
    expect(mcp.status()).toEqual({
      enabled: { status: 'connected' },
      disabled: { status: 'disabled' },
      failed: { status: 'failed', error: 'connection refused' },
    })
  })
})
