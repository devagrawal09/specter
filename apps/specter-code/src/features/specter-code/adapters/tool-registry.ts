import { evaluatePermission, type PermissionAction, type PermissionRequest, type PermissionRule } from "./permissions"

export type ToolMetadataUpdate = {
  toolName: string
  status: "started" | "output" | "completed" | "failed"
  stream?: "stdout" | "stderr"
  summary?: string
}

export type ToolContext = {
  sessionId: string
  messageId: string
  agent: string
  workspaceRoot: string
  abortSignal?: AbortSignal
  ask: (request: PermissionRequest) => Promise<PermissionAction>
  permissionRules?: readonly PermissionRule[]
  metadata: (update: ToolMetadataUpdate) => void | Promise<void>
}

export type ToolDefinition<Input = unknown, Output = unknown> = {
  name: string
  description?: string
  permission: string
  permissionTarget?: (input: Input) => string
  execute: (input: Input, context: ToolContext) => Promise<Output> | Output
}

export type ToolSummary = {
  name: string
  description?: string
  permission: string
}

export class ToolRegistry {
  readonly #tools = new Map<string, ToolDefinition>()

  register<Input = unknown, Output = unknown>(tool: ToolDefinition<Input, Output>) {
    if (this.#tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`)
    }

    this.#tools.set(tool.name, tool as ToolDefinition)
  }

  get(name: string) {
    return this.#tools.get(name)
  }

  list(): ToolSummary[] {
    return [...this.#tools.values()].map(({ name, description, permission }) => ({
      name,
      description,
      permission,
    }))
  }

  async execute<Output = unknown>(
    name: string,
    input: unknown,
    context: ToolContext,
  ): Promise<Output> {
    const tool = this.#tools.get(name)
    if (!tool) throw new Error(`Unknown tool: ${name}`)

    if (tool.permissionTarget) {
      const target = tool.permissionTarget(input)
      const request = { permission: tool.permission, target }
      const policyDecision = context.permissionRules?.length
        ? evaluatePermission(context.permissionRules, request).action
        : "ask"
      const decision =
        policyDecision === "ask" ? await context.ask(request) : policyDecision
      if (decision !== "allow") throw new Error(`Tool denied: ${name} for ${target}`)
    }

    return (await tool.execute(input, context)) as Output
  }
}

export function createToolRegistry() {
  return new ToolRegistry()
}
