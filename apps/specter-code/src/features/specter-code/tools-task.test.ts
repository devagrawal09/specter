import { describe, expect, it, vi } from 'vitest'

import { createTaskRunner, type TaskExecutorResult } from './adapters/task-runner'
import type { ToolContext } from './adapters/tool-registry'
import { createTaskTool } from './tools/task'
import { createTaskStatusTool } from './tools/task-status'

const createContext = (overrides: Partial<ToolContext> = {}): ToolContext => ({
  sessionId: 'session-task-1',
  messageId: 'message-task-1',
  agent: 'build',
  workspaceRoot: '/workspace/project',
  abortSignal: new AbortController().signal,
  ask: vi.fn(async () => 'allow' as const),
  metadata: vi.fn(),
  ...overrides,
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('task/subagent tools', () => {
  it('spawns a background subagent task and reports status until completion', async () => {
    const completion = deferred<TaskExecutorResult>()
    const execute = vi.fn(async () => completion.promise)
    const runner = createTaskRunner({ execute })
    const taskTool = createTaskTool(runner)
    const taskStatusTool = createTaskStatusTool(runner)
    const context = createContext()

    await expect(
      taskTool.execute(
        {
          taskId: 'task-1',
          description: 'Inspect failing tests',
          prompt: ' Find the smallest failing Specter Code test ',
          agent: 'reviewer',
        },
        context,
      ),
    ).resolves.toEqual({
      taskId: 'task-1',
      sessionId: 'session-task-1',
      messageId: 'message-task-1',
      agent: 'reviewer',
      description: 'Inspect failing tests',
      status: 'running',
    })

    expect(execute).toHaveBeenCalledWith({
      taskId: 'task-1',
      sessionId: 'session-task-1',
      messageId: 'message-task-1',
      parentAgent: 'build',
      agent: 'reviewer',
      description: 'Inspect failing tests',
      prompt: 'Find the smallest failing Specter Code test',
      workspaceRoot: '/workspace/project',
      abortSignal: context.abortSignal,
    })
    expect(context.metadata).toHaveBeenCalledWith({
      toolName: 'task',
      status: 'started',
      summary: 'Started reviewer task task-1: Inspect failing tests',
    })

    await expect(
      taskStatusTool.execute({ taskId: 'task-1' }, context),
    ).resolves.toMatchObject({
      taskId: 'task-1',
      status: 'running',
      result: undefined,
    })

    completion.resolve({ summary: 'Use the focused Vitest scenario', output: 'src/features/specter-code/scenarios.test.ts' })
    await flushMicrotasks()

    await expect(
      taskStatusTool.execute({ taskId: 'task-1' }, context),
    ).resolves.toMatchObject({
      taskId: 'task-1',
      status: 'completed',
      result: { summary: 'Use the focused Vitest scenario', output: 'src/features/specter-code/scenarios.test.ts' },
    })
    expect(context.metadata).toHaveBeenCalledWith({
      toolName: 'task-status',
      status: 'completed',
      summary: 'Task task-1 completed: Use the focused Vitest scenario',
    })
  })

  it('rejects empty task prompts and unknown task status requests before emitting metadata', async () => {
    const runner = createTaskRunner({ execute: async () => ({ summary: 'unused' }) })
    const taskTool = createTaskTool(runner)
    const taskStatusTool = createTaskStatusTool(runner)
    const context = createContext()

    await expect(
      taskTool.execute({ taskId: 'bad-task', prompt: '   ' }, context),
    ).rejects.toThrow('Task prompt is required')
    await expect(
      taskStatusTool.execute({ taskId: 'missing-task' }, context),
    ).rejects.toThrow('Unknown task: missing-task')
    expect(context.metadata).not.toHaveBeenCalled()
  })
})
