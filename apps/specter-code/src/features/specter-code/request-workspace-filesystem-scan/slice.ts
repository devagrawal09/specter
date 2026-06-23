import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { workspaceFilesystemScanRequestedEvent } from '../events'

const requestWorkspaceFilesystemScan = createCommandSlice(
  'requestWorkspaceFilesystemScan',
  'Requests a workspace filesystem metadata scan.',
)
  .schema(
    z.object({
      workspaceId: z.string(),
      reason: z.enum(['workspaceCreated', 'userRequested', 'agentToolChanged']),
      requestedBy: z.discriminatedUnion('type', [
        z.object({
          type: z.literal('user'),
          userId: z.string().optional(),
          displayName: z.string(),
        }),
        z.object({
          type: z.literal('agent'),
          agentId: z.string(),
          displayName: z.string(),
        }),
        z.object({
          type: z.literal('system'),
        }),
      ]),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .scenarios(
    {
      description: 'Requests an explicit user-triggered filesystem scan.',
      given: [],
      when: {
        workspaceId: 'workspace-1',
        reason: 'userRequested',
        requestedBy: { type: 'user', userId: 'user-1', displayName: 'Ada' },
      },
      expect: [
        workspaceFilesystemScanRequestedEvent.create({
          scanId: 'generated',
          workspaceId: 'workspace-1',
          reason: 'userRequested',
          requestedBy: { type: 'user', userId: 'user-1', displayName: 'Ada' },
        }),
      ],
    },
    {
      description: 'Requests a scan after an agent tool changes files.',
      given: [],
      when: {
        workspaceId: 'workspace-1',
        reason: 'agentToolChanged',
        requestedBy: {
          type: 'agent',
          agentId: 'specter',
          displayName: 'Specter',
        },
      },
      expect: [
        workspaceFilesystemScanRequestedEvent.create({
          scanId: 'generated',
          workspaceId: 'workspace-1',
          reason: 'agentToolChanged',
          requestedBy: {
            type: 'agent',
            agentId: 'specter',
            displayName: 'Specter',
          },
        }),
      ],
    },
  )
  .handle(async (command) => {
    return [
      workspaceFilesystemScanRequestedEvent.create({
        scanId: crypto.randomUUID(),
        workspaceId: command.workspaceId,
        reason: command.reason,
        requestedBy: command.requestedBy,
      }),
    ]
  })

export default requestWorkspaceFilesystemScan
