import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'
import { z } from 'zod'

import { defineMemorySliceStore } from '../../../testing/memory-slice-store'
import { sessionCreatedEvent } from '../events'

const createSession = implementCommand(specification)
  .inputSchema(
    z.object({
      sessionId: z.string(),
      parentSessionId: z.string().optional(),
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
  .store(defineMemorySliceStore(() => ({})))

  .handle(async (command) => {
    const title = command.title.trim()

    if (!title) {
      throw new Error('Session title is required')
    }

    return [
      sessionCreatedEvent.create({
        sessionId: command.sessionId,
        parentSessionId: command.parentSessionId,
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
