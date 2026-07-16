import { describe, expect, it, vi } from 'vitest'

import type { ToolContext } from './adapters/tool-registry'
import { questionTool } from './tools/question'

const createContext = (overrides: Partial<ToolContext> = {}): ToolContext => ({
  sessionId: 'session-question-1',
  messageId: 'message-question-1',
  agent: 'build',
  workspaceRoot: '/workspace/project',
  abortSignal: new AbortController().signal,
  ask: vi.fn(async () => 'allow' as const),
  metadata: vi.fn(),
  ...overrides,
})

describe('question tool', () => {
  it('normalizes a pending user question and reports metadata without permission gating', async () => {
    const context = createContext()

    await expect(
      questionTool.execute(
        {
          questionId: 'question-1',
          prompt: ' Which migration should I run? ',
          options: [
            { id: 'safe', label: 'Safe schema migration' },
            { id: 'fast', label: 'Fast data-only migration' },
          ],
          allowFreeform: true,
        },
        context,
      ),
    ).resolves.toEqual({
      questionId: 'question-1',
      sessionId: 'session-question-1',
      messageId: 'message-question-1',
      prompt: 'Which migration should I run?',
      options: [
        { id: 'safe', label: 'Safe schema migration' },
        { id: 'fast', label: 'Fast data-only migration' },
      ],
      allowFreeform: true,
      status: 'pending',
    })
    expect(context.ask).not.toHaveBeenCalled()
    expect(context.metadata).toHaveBeenCalledWith({
      toolName: 'question',
      status: 'completed',
      summary: 'Asked question: Which migration should I run?',
    })
  })

  it('rejects empty prompts and empty option labels before emitting metadata', async () => {
    const context = createContext()

    await expect(
      questionTool.execute({ prompt: '   ' }, context),
    ).rejects.toThrow('Question prompt is required')
    await expect(
      questionTool.execute(
        { prompt: 'Choose one', options: [{ id: 'empty', label: '   ' }] },
        context,
      ),
    ).rejects.toThrow('Question option label is required')
    expect(context.metadata).not.toHaveBeenCalled()
  })
})
