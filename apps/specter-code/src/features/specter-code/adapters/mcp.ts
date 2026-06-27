import type { ToolDefinition, ToolRegistry } from './tool-registry.ts'

export type McpToolDefinition = {
  name: string
  description?: string
  inputSchema?: unknown
}

export type McpCallToolRequest = {
  name: string
  arguments?: Record<string, unknown>
}

export type McpClient = {
  listTools: () => Promise<McpToolDefinition[]> | McpToolDefinition[]
  callTool: (request: McpCallToolRequest) => Promise<unknown> | unknown
  close?: () => Promise<void> | void
}

export type McpStatus =
  | { status: 'connected' }
  | { status: 'disabled' }
  | { status: 'failed'; error: string }

export type McpClientEntry = {
  name: string
  client: McpClient
}

export class McpClientRegistry {
  readonly #clients = new Map<string, McpClient>()
  readonly #statuses = new Map<string, McpStatus>()

  connect(name: string, client: McpClient) {
    this.#clients.set(name, client)
    this.#statuses.set(name, { status: 'connected' })
  }

  disable(name: string) {
    this.#clients.delete(name)
    this.#statuses.set(name, { status: 'disabled' })
  }

  fail(name: string, error: unknown) {
    this.#clients.delete(name)
    this.#statuses.set(name, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    })
  }

  connectedClients(): McpClientEntry[] {
    return [...this.#clients.entries()]
      .filter(([name]) => this.#statuses.get(name)?.status === 'connected')
      .map(([name, client]) => ({ name, client }))
  }

  status(): Record<string, McpStatus> {
    return Object.fromEntries(this.#statuses.entries())
  }
}

export function createMcpClientRegistry() {
  return new McpClientRegistry()
}

export function sanitizeMcpToolName(serverName: string, toolName: string) {
  const sanitize = (value: string) =>
    value
      .trim()
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/_{2,}/g, '_')
  return [sanitize(serverName), sanitize(toolName)].filter(Boolean).join('_')
}

function toArguments(input: unknown): Record<string, unknown> | undefined {
  if (input === undefined || input === null) return undefined
  if (typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>
  }
  return { input }
}

function createMcpToolDefinition(
  serverName: string,
  mcpTool: McpToolDefinition,
  client: McpClient,
): ToolDefinition<unknown, unknown> {
  const toolName = sanitizeMcpToolName(serverName, mcpTool.name)
  return {
    name: toolName,
    description: `MCP ${serverName}: ${mcpTool.description ?? mcpTool.name}`,
    permission: `mcp.${serverName}.${mcpTool.name}`,
    permissionTarget: () => `${serverName}/${mcpTool.name}`,
    async execute(input, context) {
      try {
        const result = await client.callTool({
          name: mcpTool.name,
          arguments: toArguments(input),
        })
        await context.metadata({
          toolName,
          status: 'completed',
          summary: `Called MCP ${serverName}/${mcpTool.name}`,
        })
        return {
          server: serverName,
          tool: mcpTool.name,
          result,
        }
      } catch (error) {
        await context.metadata({
          toolName,
          status: 'failed',
          summary: error instanceof Error ? error.message : 'MCP tool failed',
        })
        throw error
      }
    },
  }
}

export async function registerMcpTools(
  registry: ToolRegistry,
  mcpRegistry: McpClientRegistry,
) {
  for (const { name: serverName, client } of mcpRegistry.connectedClients()) {
    const tools = await client.listTools()
    for (const tool of tools) {
      registry.register(createMcpToolDefinition(serverName, tool, client))
    }
  }
}
