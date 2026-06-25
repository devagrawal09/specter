import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { sessionCreatedEvent } from '../events'

const forkSession = createCommandSlice(
  'forkSession',
  'Creates a child session forked from an existing coding-agent session.',
)
  .schema(
    z.object({
      sessionId: z.string(),
      newSessionId: z.string().optional(),
      workspaceId: z.string(),
      title: z.string(),
      directory: z.string(),
      agent: z.string(),
      model: z.object({
        providerId: z.string(),
        modelId: z.string(),
      }),
      createdBy: z
        .object({
          userId: z.string().optional(),
          displayName: z.string(),
        })
        .optional(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .scenarios(
    {
      description: 'Creates a child session that retains the parent session id.',
      given: [],
      when: {
        sessionId: 'session-parent',
        newSessionId: 'session-child',
        workspaceId: 'workspace-1',
        title: '  Investigate alternative  ',
        directory: '/tmp/project',
        agent: 'build',
        model: { providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4' },
        createdBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
      },
      expect: [
        sessionCreatedEvent.create({
          sessionId: 'session-child',
          parentSessionId: 'session-parent',
          workspaceId: 'workspace-1',
          title: 'Investigate alternative',
          directory: '/tmp/project',
          agent: 'build',
          model: { providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4' },
          createdBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
        }),
      ],
    },
    {
      description: 'Rejects a blank fork title.',
      given: [],
      when: {
        sessionId: 'session-parent',
        workspaceId: 'workspace-1',
        title: '   ',
        directory: '/tmp/project',
        agent: 'build',
        model: { providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4' },
      },
      expect: [],
      reject: { reason: 'Session title is required' },
    },
  )
  .handle(async (command) => {
    const title = command.title.trim()
    if (!title) throw new Error('Session title is required')

    return [
      sessionCreatedEvent.create({
        sessionId: command.newSessionId ?? crypto.randomUUID(),
        parentSessionId: command.sessionId,
        workspaceId: command.workspaceId,
        title,
        directory: command.directory,
        agent: command.agent,
        model: command.model,
        createdBy: command.createdBy,
      }),
    ]
  })

export default forkSession
