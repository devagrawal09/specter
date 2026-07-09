import { createQuerySlice } from '@specter-ts/core'
import type { Event } from '@specter-ts/core'
import { z } from 'zod'

import { createSqliteSliceStore } from '../../../db/specter-sqlite'
import { workspaceCreatedEvent } from '../events'

type Workspace = {
  id: string
  name: string
}

type WorkspacesState = {
  workspaces: Workspace[]
}

const workspacesQuery = createQuerySlice('workspacesQuery', 'Lists workspaces.')
  .schema(z.object({}))
  .store(createSqliteSliceStore<WorkspacesState>(() => ({ workspaces: [] })))
  .apply({
    [workspaceCreatedEvent.type]: async (
      event: Event<typeof workspaceCreatedEvent.type, unknown>,
      state: WorkspacesState,
    ) => {
      const payload = await workspaceCreatedEvent.decode(event.payload)

      if (
        state.workspaces.some(
          (workspace) => workspace.id === payload.workspaceId,
        )
      ) {
        return
      }

      state.workspaces.push({
        id: payload.workspaceId,
        name: payload.name,
      })
    },
  })
  .scenarios({
    description: 'Lists workspaces in creation order.',
    given: [
      workspaceCreatedEvent.create({
        workspaceId: 'workspace-1',
        name: 'Main Workspace',
      }),
      workspaceCreatedEvent.create({
        workspaceId: 'workspace-2',
        name: 'Design Lab',
      }),
    ],
    when: {},
    expect: [
      { id: 'workspace-1', name: 'Main Workspace' },
      { id: 'workspace-2', name: 'Design Lab' },
    ],
  })
  .handle(async (_query, state) => state.workspaces)

export default workspacesQuery
