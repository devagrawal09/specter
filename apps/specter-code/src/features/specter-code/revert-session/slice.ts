import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { sessionRevertRequestedEvent } from '../events'

const fileSnapshotInput = z.object({
  path: z.string(),
  existed: z.boolean(),
  content: z.string().optional(),
})

const revertSession = createCommandSlice(
  'revertSession',
  'Requests a session file revert from captured tool snapshots.',
)
  .schema(
    z.object({
      revertId: z.string().optional(),
      sessionId: z.string(),
      workspaceId: z.string(),
      snapshots: z.array(fileSnapshotInput),
      requestedBy: z
        .object({
          userId: z.string().optional(),
          displayName: z.string(),
        })
        .optional(),
      reason: z.string().optional(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .scenarios(
    {
      description: 'Requests reverting a session from captured file snapshots.',
      given: [],
      when: {
        revertId: 'revert-1',
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        snapshots: [
          { path: 'src/app.ts', existed: true, content: 'export const value = 1\n' },
          { path: 'src/generated.ts', existed: false },
        ],
        requestedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
        reason: 'Undo last tool changes',
      },
      expect: [
        sessionRevertRequestedEvent.create({
          revertId: 'revert-1',
          sessionId: 'session-1',
          workspaceId: 'workspace-1',
          snapshots: [
            { path: 'src/app.ts', existed: true, content: 'export const value = 1\n' },
            { path: 'src/generated.ts', existed: false },
          ],
          requestedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
          reason: 'Undo last tool changes',
        }),
      ],
    },
    {
      description: 'Rejects revert requests without snapshots.',
      given: [],
      when: {
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        snapshots: [],
      },
      expect: [],
      reject: { reason: 'At least one snapshot is required to revert a session' },
    },
  )
  .handle(async (command) => {
    if (command.snapshots.length === 0) {
      throw new Error('At least one snapshot is required to revert a session')
    }

    return [
      sessionRevertRequestedEvent.create({
        revertId: command.revertId ?? crypto.randomUUID(),
        sessionId: command.sessionId,
        workspaceId: command.workspaceId,
        snapshots: command.snapshots,
        requestedBy: command.requestedBy,
        reason: command.reason,
      }),
    ]
  })

export default revertSession
