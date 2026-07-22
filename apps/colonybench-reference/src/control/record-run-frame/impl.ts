import type { SliceStoreAdapter } from '@specter-ts/core'
import { z } from 'zod'

import { applyRunCreated } from '../apply'
import { runCreatedEvent, runFrameRecordedEvent } from '../events'
import type { ColonyBenchControlState } from '../state'
import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'

const frameSchema = z.object({
  runId: z.string(),
  tick: z.number().int().nonnegative(),
  score: z.number(),
  workerCount: z.number().int().nonnegative(),
  baseLevel: z.number().int().nonnegative(),
  baseEnergy: z.number().nonnegative(),
  commandCount: z.number().int().nonnegative(),
  eventTypes: z.array(z.string()),
})

export function createRecordRunFrame(
  store: SliceStoreAdapter<ColonyBenchControlState>,
) {
  return implementCommand<'recordRunFrame'>(specification)
    .inputSchema(frameSchema)
    .store(store)
    .apply(runCreatedEvent, applyRunCreated)
    .handle(async (command, state) => {
      if (!state.runs[command.runId])
        throw new Error(`Run not found: ${command.runId}`)
      return [
        runFrameRecordedEvent.create({
          ...command,
          eventTypes: [...command.eventTypes],
        }),
      ]
    })
}
