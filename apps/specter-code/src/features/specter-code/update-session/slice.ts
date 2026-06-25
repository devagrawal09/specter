import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { sessionUpdatedEvent } from '../events'

const updateSession = createCommandSlice(
  'updateSession',
  'Updates mutable metadata for an existing coding-agent session.',
)
  .schema(
    z.object({
      sessionId: z.string(),
      title: z.string().optional(),
      directory: z.string().optional(),
      agent: z.string().optional(),
      model: z
        .object({
          providerId: z.string(),
          modelId: z.string(),
        })
        .optional(),
      updatedBy: z
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
      description:
        'Updates session title, directory, agent, and model metadata.',
      given: [],
      when: {
        sessionId: 'session-1',
        title: '  Ship rename  ',
        directory: '/tmp/renamed',
        agent: 'senior',
        model: { providerId: 'anthropic', modelId: 'claude-opus-4.1' },
        updatedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
      },
      expect: [
        sessionUpdatedEvent.create({
          sessionId: 'session-1',
          title: 'Ship rename',
          directory: '/tmp/renamed',
          agent: 'senior',
          model: { providerId: 'anthropic', modelId: 'claude-opus-4.1' },
          updatedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
        }),
      ],
    },
    {
      description: 'Rejects an empty update payload.',
      given: [],
      when: { sessionId: 'session-1' },
      expect: [],
      reject: {
        reason: 'Session update must include at least one mutable field',
      },
    },
    {
      description: 'Rejects a blank session title update.',
      given: [],
      when: { sessionId: 'session-1', title: '   ' },
      expect: [],
      reject: { reason: 'Session title is required' },
    },
  )
  .handle(async (command) => {
    const title = command.title === undefined ? undefined : command.title.trim()
    if (command.title !== undefined && !title) {
      throw new Error('Session title is required')
    }

    const update = {
      title,
      directory: command.directory,
      agent: command.agent,
      model: command.model,
    }

    if (Object.values(update).every((value) => value === undefined)) {
      throw new Error('Session update must include at least one mutable field')
    }

    return [
      sessionUpdatedEvent.create({
        sessionId: command.sessionId,
        ...update,
        updatedBy: command.updatedBy,
      }),
    ]
  })

export default updateSession
