import type { SliceStoreAdapter } from '@specter-ts/core'
import { z } from 'zod'

import { runCreatedEvent } from '../events'
import type { ColonyBenchControlState } from '../state'
import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'

export function createCreateRun(
  store: SliceStoreAdapter<ColonyBenchControlState>,
) {
  return implementCommand<'createRun'>(specification)
    .inputSchema(z.object({ runId: z.string(), name: z.string().optional() }))
    .store(store)
    .handle(async (command) => [
      runCreatedEvent.create({
        runId: command.runId,
        name: command.name?.trim() || 'Untitled run',
      }),
    ])
}
