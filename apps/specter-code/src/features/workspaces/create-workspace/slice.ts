import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createSqliteSliceStore } from '../../../db/specter-sqlite'
import { workspaceCreatedEvent } from '../events'

const createWorkspace = createCommandSlice(
  'createWorkspace',
  'Creates a workspace.',
)
  .schema(
    z.object({
      name: z.string(),
      workspaceId: z.string().optional(),
    }),
  )
  .store(createSqliteSliceStore(() => ({})))
  .scenarios(
    {
      description: 'Creates a workspace with a trimmed name.',
      given: [],
      when: { name: '  Design Lab  ' },
      expect: [
        workspaceCreatedEvent.create({
          workspaceId: 'generated',
          name: 'Design Lab',
        }),
      ],
    },
    {
      description: 'Rejects a blank workspace name.',
      given: [],
      when: { name: '   ' },
      expect: [],
      reject: { reason: 'Workspace name is required' },
    },
  )
  .handle(async (command) => {
    const name = command.name.trim()

    if (!name) {
      throw new Error('Workspace name is required')
    }

    return [
      workspaceCreatedEvent.create({
        workspaceId: command.workspaceId ?? crypto.randomUUID(),
        name,
      }),
    ]
  })

export default createWorkspace
