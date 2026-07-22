import { z } from 'zod'

import { connectionArchiveChangedEvent, recordsConnectedEvent } from '../events'
import { defineWorklogMemoryStore } from '../memory-store'
import type { Connection } from '../model'
import { connectionsQuerySpec } from './spec'

const store = defineWorklogMemoryStore(() => ({
  connections: new Map<string, Connection>(),
}))
const refSchema = z
  .object({ kind: z.enum(['journal', 'task', 'topic']), id: z.string() })
  .strict()

export const connectionsQuery = connectionsQuerySpec
  .inputSchema(z.object({ includeArchived: z.boolean() }).strict())
  .outputSchema(
    z.array(
      z
        .object({
          id: z.string(),
          left: refSchema,
          right: refSchema,
          connectedAt: z.string(),
          archived: z.boolean(),
        })
        .strict(),
    ),
  )
  .store(store)
  .apply(recordsConnectedEvent, async (event, state) => {
    state.connections.set(event.payload.connectionId, {
      id: event.payload.connectionId,
      left: event.payload.left,
      right: event.payload.right,
      connectedAt: event.payload.connectedAt,
      archived: false,
    })
  })
  .apply(connectionArchiveChangedEvent, async (event, state) => {
    const connection = state.connections.get(event.payload.connectionId)
    if (connection) connection.archived = event.payload.archived
  })
  .handle(async (query, state) =>
    [...state.connections.values()]
      .filter((connection) => query.includeArchived || !connection.archived)
      .sort((a, b) => b.connectedAt.localeCompare(a.connectedAt)),
  )
