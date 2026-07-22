import specification from './spec.json' with { type: 'json' }
import { implementQuery } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { workspaceCreatedEvent } from '../events'

type WorkspaceListItem = {
  id: string
  name: string
  createdBy?: {
    userId?: string
    displayName: string
  }
}

type WorkspaceListState = {
  workspaces: WorkspaceListItem[]
}

const workspaceList = implementQuery<'workspaceList'>(specification)
  .inputSchema(z.object({}))
  .outputSchema<WorkspaceListItem[]>()
  .store(createMemorySliceStore<WorkspaceListState>(() => ({ workspaces: [] })))
  .apply(workspaceCreatedEvent, async (event, state) => {
    const payload = event.payload as Awaited<
      ReturnType<typeof workspaceCreatedEvent.decode>
    >

    if (
      state.workspaces.some((workspace) => workspace.id === payload.workspaceId)
    ) {
      return
    }

    state.workspaces.push({
      id: payload.workspaceId,
      name: payload.name,
      createdBy: payload.createdBy,
    })
  })
  .handle(async (_query, state) => state.workspaces)

export default workspaceList
