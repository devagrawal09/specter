import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { sessionMessageDeletedEvent } from '../events'

const deleteSessionMessage = createCommandSlice(
  'deleteSessionMessage',
  'Deletes a user-visible session message from the transcript.',
)
  .schema(
    z.object({
      sessionId: z.string(),
      messageId: z.string(),
      deletedBy: z
        .object({ userId: z.string().optional(), displayName: z.string() })
        .optional(),
      reason: z.string().optional(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .scenarios({
    description: 'Records a session message deletion event.',
    given: [],
    when: {
      sessionId: 'session-1',
      messageId: 'message-1',
      deletedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
    },
    expect: [
      sessionMessageDeletedEvent.create({
        sessionId: 'session-1',
        messageId: 'message-1',
        deletedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
      }),
    ],
  })
  .handle(async (command) => [
    sessionMessageDeletedEvent.create({
      sessionId: command.sessionId,
      messageId: command.messageId,
      deletedBy: command.deletedBy,
      reason: command.reason,
    }),
  ])

export default deleteSessionMessage
