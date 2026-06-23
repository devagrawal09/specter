import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { sessionCreatedEvent } from '../events'

const createSession = createCommandSlice(
  'createSession',
  'Creates a coding-agent session in a workspace.',
)
  .schema(
    z.object({
      sessionId: z.string().optional(),
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
      description: 'Creates a session with title, directory, agent, and model.',
      given: [],
      when: {
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        title: '  Fix tests  ',
        directory: '/tmp/project',
        agent: 'build',
        model: { providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4' },
        createdBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
      },
      expect: [
        sessionCreatedEvent.create({
          sessionId: 'session-1',
          workspaceId: 'workspace-1',
          title: 'Fix tests',
          directory: '/tmp/project',
          agent: 'build',
          model: { providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4' },
          createdBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
        }),
      ],
    },
    {
      description: 'Rejects a blank session title.',
      given: [],
      when: {
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

    if (!title) {
      throw new Error('Session title is required')
    }

    return [
      sessionCreatedEvent.create({
        sessionId: command.sessionId ?? crypto.randomUUID(),
        workspaceId: command.workspaceId,
        title,
        directory: command.directory,
        agent: command.agent,
        model: command.model,
        createdBy: command.createdBy,
      }),
    ]
  })

export default createSession
