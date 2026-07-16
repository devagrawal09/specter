import { createEventDefinition } from '@specter-ts/core'
import { z } from 'zod'

export const workspaceCreatedEvent = createEventDefinition(
  'workspace-created',
  z.object({
    workspaceId: z.string(),
    name: z.string(),
  }),
)

export const workspaceEventDefinitions = [workspaceCreatedEvent] as const
