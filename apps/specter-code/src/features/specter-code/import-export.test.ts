import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import {
  buildSpecterCodeSessionExport,
  normalizeSpecterCodeSessionExport,
} from './adapters/import-export'

const execFileAsync = promisify(execFile)

describe('Specter Code session import/export', () => {
  it('exports a session with its causal transcript, run, tool, permission, todo, question, and PTY events', () => {
    const exported = buildSpecterCodeSessionExport({
      sessionId: 'session-main',
      exportedAt: '2026-06-24T00:00:00.000Z',
      events: [
        event('workspace-created', {
          workspaceId: 'workspace-main',
          name: 'Main workspace',
        }),
        event('session-created', {
          sessionId: 'session-main',
          workspaceId: 'workspace-main',
          title: 'Fix bug',
          directory: '/repo',
          agent: 'build',
          model: { providerId: 'localai', modelId: 'qwen-code' },
        }),
        event('session-created', {
          sessionId: 'session-other',
          workspaceId: 'workspace-main',
          title: 'Other',
          directory: '/repo',
          agent: 'build',
          model: { providerId: 'localai', modelId: 'qwen-code' },
        }),
        event('user-message-submitted', {
          messageId: 'message-main',
          sessionId: 'session-main',
          workspaceId: 'workspace-main',
          content: 'add a regression test',
          submittedBy: { displayName: 'Ada' },
        }),
        event('agent-run-requested', {
          runId: 'run-main',
          workspaceId: 'workspace-main',
          postId: 'message-main',
          agentId: 'build',
          agentName: 'Build Agent',
          requestedBy: { type: 'user', displayName: 'Ada' },
        }),
        event('tool-call-started', {
          toolCallId: 'tool-main',
          runId: 'run-main',
          workspaceId: 'workspace-main',
          agentId: 'build',
          toolName: 'grep',
        }),
        event('tool-approval-requested', {
          requestId: 'approval-main',
          sessionId: 'session-main',
          messageId: 'message-main',
          workspaceId: 'workspace-main',
          agentId: 'build',
          toolCallId: 'tool-main',
          toolName: 'shell',
          permission: 'shell.execute',
          target: 'pnpm test',
        }),
        event('todo-list-updated', {
          sessionId: 'session-main',
          messageId: 'message-main',
          items: [{ id: 'todo-1', content: 'Add test', status: 'completed' }],
        }),
        event('question-asked', {
          questionId: 'question-main',
          sessionId: 'session-main',
          messageId: 'message-main',
          prompt: 'Run tests?',
          options: [{ id: 'yes', label: 'Yes' }],
          allowFreeform: false,
        }),
        event('pty-session-started', {
          ptySessionId: 'pty-main',
          sessionId: 'session-main',
          workspaceId: 'workspace-main',
          cwd: '/repo',
          shell: '/bin/bash',
          startedAt: '2026-06-24T00:00:01.000Z',
        }),
        event('agent-run-streamed', {
          runId: 'run-main',
          workspaceId: 'workspace-main',
          agentId: 'build',
          chunkId: 'chunk-1',
          sequence: 0,
          delta: 'Done.',
        }),
        event('post-reply-created', {
          replyId: 'reply-main',
          workspaceId: 'workspace-main',
          parentPostId: 'message-main',
          author: {
            type: 'agent',
            agentId: 'build',
            displayName: 'Build Agent',
          },
          content: 'Done.',
          sourceRunId: 'run-main',
        }),
        event('agent-run-requested', {
          runId: 'run-other',
          workspaceId: 'workspace-main',
          postId: 'message-other',
          agentId: 'build',
          agentName: 'Build Agent',
          requestedBy: { type: 'user', displayName: 'Ada' },
        }),
      ],
    })

    expect(exported).toMatchObject({
      format: 'specter-code.session.v1',
      exportedAt: '2026-06-24T00:00:00.000Z',
      session: {
        sessionId: 'session-main',
        workspaceId: 'workspace-main',
        title: 'Fix bug',
        directory: '/repo',
        agent: 'build',
        model: { providerId: 'localai', modelId: 'qwen-code' },
      },
    })
    expect(exported.events.map((item) => item.type)).toEqual([
      'workspace-created',
      'session-created',
      'user-message-submitted',
      'agent-run-requested',
      'tool-call-started',
      'tool-approval-requested',
      'todo-list-updated',
      'question-asked',
      'pty-session-started',
      'agent-run-streamed',
      'post-reply-created',
    ])
  })

  it('normalizes imported session files while rejecting unknown export formats', () => {
    const normalized = normalizeSpecterCodeSessionExport({
      format: 'specter-code.session.v1',
      exportedAt: '2026-06-24T00:00:00.000Z',
      session: {
        sessionId: 'session-import',
        workspaceId: 'workspace-main',
        title: 'Imported',
        directory: '/repo',
        agent: 'build',
        model: { providerId: 'localai', modelId: 'qwen-code' },
      },
      events: [
        event('session-created', {
          sessionId: 'session-import',
          workspaceId: 'workspace-main',
          title: 'Imported',
          directory: '/repo',
          agent: 'build',
          model: { providerId: 'localai', modelId: 'qwen-code' },
        }),
      ],
    })

    expect(normalized.session.sessionId).toBe('session-import')
    expect(() =>
      normalizeSpecterCodeSessionExport({ format: 'opencode.session.v0' }),
    ).toThrow('Unsupported Specter Code session export format')
  })

  it('loads in the stripped Node runtime used by the CLI package script', async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      '--experimental-strip-types',
      '-e',
      "import('./src/features/specter-code/adapters/import-export.ts').then(() => console.log('ok'))",
    ])

    expect(stdout.trim()).toBe('ok')
  })
})

function event(type: string, payload: Record<string, unknown>) {
  return { type, payload }
}
