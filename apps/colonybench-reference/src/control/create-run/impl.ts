import { controlStore } from '../store'
import { z } from 'zod'

import { runCreatedEvent } from '../events'
import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'
export const createCreateRun = implementCommand(specification)
  .inputSchema(z.object({ runId: z.string(), name: z.string().optional() }))
  .store(controlStore)
  .handle(async (command) => [
    runCreatedEvent.create({
      runId: command.runId,
      name: command.name?.trim() || 'Untitled run',
    }),
  ])
