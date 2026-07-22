import { z } from 'zod'
import {
  emberCaughtEvent,
  emberEscapedEvent,
  lanternCheckpointRecoveredEvent,
} from '../events'
import { createLastLanternMemoryStore } from '../memory-store'
import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'

export const {
  store: recoverLanternCheckpointStore,
  layer: recoverLanternCheckpointStoreLayer,
} = createLastLanternMemoryStore('recoverLanternCheckpoint', () => ({
  ready: false,
  recovered: false,
}))

export const recoverLanternCheckpoint = implementCommand(specification)
  .inputSchema(
    z.object({ recoveredAt: z.string().datetime({ offset: true }) }).strict(),
  )
  .store(recoverLanternCheckpointStore)
  .apply(emberCaughtEvent, async (_event, state) => {
    state.ready = true
  })
  .apply(emberEscapedEvent, async (_event, state) => {
    state.ready = true
  })
  .apply(lanternCheckpointRecoveredEvent, async (_event, state) => {
    state.recovered = true
  })
  .handle(async (command, state) => {
    if (!state.ready) throw new Error('Complete both physical dice tests first')
    if (state.recovered)
      throw new Error('The checkpoint has already been recovered')
    return [lanternCheckpointRecoveredEvent.create(command)]
  })
