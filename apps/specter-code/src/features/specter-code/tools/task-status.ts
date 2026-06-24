import type { TaskRecord, TaskRunner } from '../adapters/task-runner'
import type { ToolDefinition } from '../adapters/tool-registry'

export type TaskStatusToolInput = {
  taskId: string
}

export type TaskStatusToolOutput = Pick<
  TaskRecord,
  | 'taskId'
  | 'sessionId'
  | 'messageId'
  | 'parentAgent'
  | 'agent'
  | 'description'
  | 'prompt'
  | 'workspaceRoot'
  | 'status'
  | 'startedAt'
  | 'completedAt'
  | 'result'
  | 'error'
>

function summarizeTask(record: TaskRecord) {
  if (record.status === 'completed') {
    return 'Task ' + record.taskId + ' completed: ' + (record.result?.summary ?? 'done')
  }
  if (record.status === 'failed') {
    return 'Task ' + record.taskId + ' failed: ' + (record.error ?? 'unknown error')
  }
  return 'Task ' + record.taskId + ' is running'
}

export function createTaskStatusTool(
  runner: TaskRunner,
): ToolDefinition<TaskStatusToolInput, TaskStatusToolOutput> {
  return {
    name: 'task-status',
    description: 'Inspect the current state of a background subagent task',
    permission: 'task.status',
    permissionTarget: (input) => input.taskId,
    async execute(input, context) {
      const taskId = input.taskId.trim()
      if (!taskId) throw new Error('Task id is required')
      const record = runner.getTask(taskId)
      if (!record) throw new Error('Unknown task: ' + taskId)

      await context.metadata({
        toolName: 'task-status',
        status: record.status === 'failed' ? 'failed' : 'completed',
        summary: summarizeTask(record),
      })

      return {
        taskId: record.taskId,
        sessionId: record.sessionId,
        messageId: record.messageId,
        parentAgent: record.parentAgent,
        agent: record.agent,
        description: record.description,
        prompt: record.prompt,
        workspaceRoot: record.workspaceRoot,
        status: record.status,
        startedAt: record.startedAt,
        completedAt: record.completedAt,
        result: record.result,
        error: record.error,
      }
    },
  }
}
