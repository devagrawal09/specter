import { z } from 'zod'
import { lanternTestStartedEvent } from '../events'
import { createLastLanternMemoryStore } from '../memory-store'
import { beginLanternTestSpec } from './spec'

const store = createLastLanternMemoryStore(() => ({ started: false }))

export const beginLanternTest = beginLanternTestSpec
  .inputSchema(
    z.object({ startedAt: z.string().datetime({ offset: true }) }).strict(),
  )
  .store(store)
  .apply(lanternTestStartedEvent, async (_event, state) => {
    state.started = true
  })
  .handle(async (command, state) => {
    if (state.started) throw new Error('The Last Lantern has already begun')
    return [lanternTestStartedEvent.create(command)]
  })
