import { z } from 'zod'
import { lanternTestStartedEvent } from '../events'
import { createLastLanternMemoryStore } from '../memory-store'
import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'

export const {
  store: beginLanternTestStore,
  layer: beginLanternTestStoreLayer,
} = createLastLanternMemoryStore('beginLanternTest', () => ({
  started: false,
}))

export const beginLanternTest = implementCommand(specification)
  .inputSchema(
    z.object({ startedAt: z.string().datetime({ offset: true }) }).strict(),
  )
  .store(beginLanternTestStore)
  .apply(lanternTestStartedEvent, async (_event, state) => {
    state.started = true
  })
  .handle(async (command, state) => {
    if (state.started) throw new Error('The Last Lantern has already begun')
    return [lanternTestStartedEvent.create(command)]
  })
