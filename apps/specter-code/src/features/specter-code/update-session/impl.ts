import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'
import { z } from 'zod'

import { defineMemorySliceStore } from '../../../testing/memory-slice-store'
import { sessionUpdatedEvent } from '../events'

const updateSession = implementCommand(specification)
  .inputSchema(
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
  .store(defineMemorySliceStore(() => ({})))

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
