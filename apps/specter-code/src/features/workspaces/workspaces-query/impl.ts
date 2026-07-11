import workspacesQuerySpec from './spec'
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

const workspacesQuery = workspacesQuerySpec
  .inputSchema(z.object({}))
  .outputSchema<Workspace[]>()
  .store(createSqliteSliceStore<WorkspacesState>(() => ({ workspaces: [] })))
  .apply(workspaceCreatedEvent, async (event, state) => {
      const payload = event.payload

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
    })
  .handle(async (_query, state) => state.workspaces)

export default workspacesQuery
