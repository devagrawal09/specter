import revertSessionSpec from './spec'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { sessionRevertRequestedEvent } from '../events'

const fileSnapshotInput = z.object({
  path: z.string(),
  existed: z.boolean(),
  content: z.string().optional(),
})

const revertSession = revertSessionSpec
  .inputSchema(
    z.object({
      revertId: z.string(),
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

  .handle(async (command) => {
    if (command.snapshots.length === 0) {
      throw new Error('At least one snapshot is required to revert a session')
    }

    return [
      sessionRevertRequestedEvent.create({
        revertId: command.revertId,
        sessionId: command.sessionId,
        workspaceId: command.workspaceId,
        snapshots: command.snapshots,
        requestedBy: command.requestedBy,
        reason: command.reason,
      }),
    ]
  })

export default revertSession
