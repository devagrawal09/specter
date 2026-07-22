import { controlStore } from '../store'
import { z } from 'zod'

import { runCreatedEvent } from '../events'
import { createRunSpec } from './spec'

export const createCreateRun = createRunSpec
  .inputSchema(z.object({ runId: z.string(), name: z.string().optional() }))
  .store(controlStore)
  .handle(async (command) => [
    runCreatedEvent.create({
      runId: command.runId,
      name: command.name?.trim() || 'Untitled run',
    }),
  ])
