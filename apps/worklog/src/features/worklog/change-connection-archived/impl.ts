import { z } from 'zod'

import { connectionArchiveChangedEvent, recordsConnectedEvent } from '../events'
import { createWorklogMemoryStore } from '../memory-store'
import { changeConnectionArchivedSpec } from './spec'

const store = createWorklogMemoryStore(() => ({
  connections: new Map<string, boolean>(),
}))

export const changeConnectionArchived = changeConnectionArchivedSpec
  .inputSchema(
    z
      .object({
        connectionId: z.string().min(1),
        archived: z.boolean(),
        changedAt: z.string().datetime({ offset: true }),
      })
      .strict(),
  )
  .store(store)
  .apply(recordsConnectedEvent, async (event, state) => {
    state.connections.set(event.payload.connectionId, false)
  })
  .apply(connectionArchiveChangedEvent, async (event, state) => {
    if (state.connections.has(event.payload.connectionId))
      state.connections.set(event.payload.connectionId, event.payload.archived)
  })
  .handle(async (command, state) => {
    const archived = state.connections.get(command.connectionId)
    if (archived === undefined) throw new Error('Connection not found')
    if (archived === command.archived)
      throw new Error('Connection archival state is already requested')
    return [connectionArchiveChangedEvent.create(command)]
  })
