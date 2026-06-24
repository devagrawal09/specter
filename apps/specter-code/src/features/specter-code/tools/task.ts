import type { TaskRunner } from '../adapters/task-runner'
import type { ToolDefinition } from '../adapters/tool-registry'

export type TaskToolInput = {
  taskId?: string
  description?: string
  prompt: string
  agent?: string
}

export type TaskToolOutput = {
  taskId: string
  sessionId: string
  messageId: string
  agent: string
  description?: string
  status: 'running'
}

function normalizeText(value: string, errorMessage: string) {
  const normalized = value.trim()
  if (!normalized) throw new Error(errorMessage)
  return normalized
}

export function createTaskTool(
  runner: TaskRunner,
): ToolDefinition<TaskToolInput, TaskToolOutput> {
  return {
    name: 'task',
    description: 'Spawn a background subagent task for the current session',
    permission: 'task.spawn',
    permissionTarget: (input) => input.agent ?? 'subagent',
    async execute(input, context) {
      const prompt = normalizeText(input.prompt, 'Task prompt is required')
      const taskId = input.taskId ?? crypto.randomUUID()
      const agent = normalizeText(input.agent ?? context.agent, 'Task agent is required')
      const description = input.description?.trim() || undefined

      const record = runner.spawn({
        taskId,
        sessionId: context.sessionId,
        messageId: context.messageId,
        parentAgent: context.agent,
        agent,
        description,
        prompt,
        workspaceRoot: context.workspaceRoot,
        abortSignal: context.abortSignal,
      })

      await context.metadata({
        toolName: 'task',
        status: 'started',
        summary:
          'Started ' +
          record.agent +
          ' task ' +
          record.taskId +
          (record.description ? ': ' + record.description : ''),
      })

      return {
        taskId: record.taskId,
        sessionId: record.sessionId,
        messageId: record.messageId,
        agent: record.agent,
        description: record.description,
        status: 'running',
      }
    },
  }
}
