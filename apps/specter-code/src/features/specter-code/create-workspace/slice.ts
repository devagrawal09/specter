import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import {
  workspaceCreatedEvent,
  workspaceFilesystemInitializedEvent,
  workspaceFilesystemScanRequestedEvent,
} from '../events'

const createWorkspace = createCommandSlice(
  'createWorkspace',
  'Creates a workspace for posts, agents, and workspace files.',
)
  .schema(
    z.object({
      name: z.string(),
      createdBy: z
        .object({
          userId: z.string().optional(),
          displayName: z.string(),
        })
        .optional(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .scenarios(
    {
      description:
        'Creates a workspace with a trimmed name and initializes filesystem metadata.',
      given: [],
      when: {
        name: '  Design Lab  ',
        createdBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
      },
      expect: [
        workspaceCreatedEvent.create({
          workspaceId: 'generated',
          name: 'Design Lab',
          createdBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
        }),
        workspaceFilesystemInitializedEvent.create({
          workspaceId: 'generated',
        }),
        workspaceFilesystemScanRequestedEvent.create({
          scanId: 'generated',
          workspaceId: 'generated',
          reason: 'workspaceCreated',
          requestedBy: { type: 'system' },
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
    const workspaceId = crypto.randomUUID()

    if (!name) {
      throw new Error('Workspace name is required')
    }

    return [
      workspaceCreatedEvent.create({
        workspaceId,
        name,
        createdBy: command.createdBy,
      }),
      workspaceFilesystemInitializedEvent.create({
        workspaceId,
      }),
      workspaceFilesystemScanRequestedEvent.create({
        scanId: crypto.randomUUID(),
        workspaceId,
        reason: 'workspaceCreated',
        requestedBy: { type: 'system' },
      }),
    ]
  })

export default createWorkspace
