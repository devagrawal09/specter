import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { sessionDeletedEvent } from '../events'

const deleteSession = createCommandSlice(
  'deleteSession',
  'Deletes a coding-agent session from active session lists.',
)
  .schema(
    z.object({
      sessionId: z.string(),
      deletedBy: z
        .object({
          userId: z.string().optional(),
          displayName: z.string(),
        })
        .optional(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .scenarios({
    description: 'Deletes a session by id.',
    given: [],
    when: {
      sessionId: 'session-1',
      deletedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
    },
    expect: [
      sessionDeletedEvent.create({
        sessionId: 'session-1',
        deletedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
      }),
    ],
  })
  .handle(async (command) => [
    sessionDeletedEvent.create({
      sessionId: command.sessionId,
      deletedBy: command.deletedBy,
    }),
  ])

export default deleteSession
