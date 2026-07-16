import { describe, expect, it, vi } from 'vitest'

import type { ToolContext } from './adapters/tool-registry'
import { todoTool } from './tools/todo'

const createContext = (overrides: Partial<ToolContext> = {}): ToolContext => ({
  sessionId: 'session-todo-1',
  messageId: 'message-todo-1',
  agent: 'build',
  workspaceRoot: '/workspace/project',
  abortSignal: new AbortController().signal,
  ask: vi.fn(async () => 'allow' as const),
  metadata: vi.fn(),
  ...overrides,
})

describe('todo tool', () => {
  it('normalizes an ordered session todo list and reports completion metadata', async () => {
    const context = createContext()

    await expect(
      todoTool.execute(
        {
          items: [
            {
              id: 'todo-1',
              content: ' Inspect failing test ',
              status: 'in_progress',
              priority: 'high',
            },
            {
              id: 'todo-2',
              content: 'Implement smallest fix',
              status: 'pending',
            },
            {
              id: 'todo-3',
              content: 'Run verification',
              status: 'completed',
              priority: 'medium',
            },
          ],
        },
        context,
      ),
    ).resolves.toEqual({
      sessionId: 'session-todo-1',
      messageId: 'message-todo-1',
      items: [
        {
          id: 'todo-1',
          content: 'Inspect failing test',
          status: 'in_progress',
          priority: 'high',
        },
        { id: 'todo-2', content: 'Implement smallest fix', status: 'pending' },
        {
          id: 'todo-3',
          content: 'Run verification',
          status: 'completed',
          priority: 'medium',
        },
      ],
    })
    expect(context.ask).not.toHaveBeenCalled()
    expect(context.metadata).toHaveBeenCalledWith({
      toolName: 'todo',
      status: 'completed',
      summary: 'Updated 3 todos (1 pending, 1 in progress, 1 completed)',
    })
  })

  it('rejects empty todo content and invalid statuses before emitting metadata', async () => {
    const context = createContext()

    await expect(
      todoTool.execute(
        { items: [{ id: 'todo-empty', content: '   ', status: 'pending' }] },
        context,
      ),
    ).rejects.toThrow('Todo content is required')
    await expect(
      todoTool.execute(
        { items: [{ id: 'todo-bad', content: 'Ship it', status: 'blocked' }] },
        context,
      ),
    ).rejects.toThrow('Unsupported todo status: blocked')
    expect(context.metadata).not.toHaveBeenCalled()
  })
})
