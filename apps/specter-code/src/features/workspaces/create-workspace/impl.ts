import createWorkspaceSpec from './spec'
import { z } from 'zod'

import { createSqliteSliceStore } from '../../../db/specter-sqlite'
import { workspaceCreatedEvent } from '../events'

const createWorkspace = createWorkspaceSpec
  .inputSchema(
    z.object({
      name: z.string(),
      workspaceId: z.string(),
    }),
  )
  .store(createSqliteSliceStore(() => ({})))
  .handle(async (command) => {
    const name = command.name.trim()

    if (!name) {
      throw new Error('Workspace name is required')
    }

    return [
      workspaceCreatedEvent.create({
        workspaceId: command.workspaceId,
        name,
      }),
    ]
  })

export default createWorkspace
