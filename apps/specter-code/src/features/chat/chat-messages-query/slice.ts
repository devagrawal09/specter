import { createQuerySlice } from '@specter-ts/core'
import type { Event } from '@specter-ts/core'
import { z } from 'zod'

import { createSqliteSliceStore } from '../../../db/specter-sqlite'
import { messagePostedEvent } from '../events'

type ChatMessage = {
  id: string
  workspaceId: string
  author: {
    type: 'user' | 'agent'
    displayName: string
    agentId?: string
  }
  content: string
  parentMessageId?: string
}

type ChatMessagesState = {
  messages: ChatMessage[]
}

const chatMessagesQuery = createQuerySlice(
  'chatMessagesQuery',
  'Lists chat messages for a workspace.',
)
  .schema(
    z.object({
      workspaceId: z.string(),
    }),
  )
  .store(createSqliteSliceStore<ChatMessagesState>(() => ({ messages: [] })))
  .apply({
    [messagePostedEvent.type]: async (
      event: Event<typeof messagePostedEvent.type, unknown>,
      state: ChatMessagesState,
    ) => {
      const payload = await messagePostedEvent.decode(event.payload)

      state.messages.push({
        id: payload.messageId,
        workspaceId: payload.workspaceId,
        author: payload.author,
        content: payload.content,
        parentMessageId: payload.parentMessageId,
      })
    },
  })
  .scenarios({
    description: 'Lists workspace messages in posting order.',
    given: [
      messagePostedEvent.create({
        messageId: 'message-1',
        workspaceId: 'workspace-1',
        author: { type: 'user', displayName: 'Ada Lovelace' },
        content: 'Hello Specter',
      }),
      messagePostedEvent.create({
        messageId: 'message-2',
        workspaceId: 'workspace-2',
        author: { type: 'user', displayName: 'Grace Hopper' },
        content: 'Wrong workspace',
      }),
      messagePostedEvent.create({
        messageId: 'message-3',
        workspaceId: 'workspace-1',
        author: { type: 'agent', displayName: 'Specter', agentId: 'specter' },
        content: 'I can help.',
        parentMessageId: 'message-1',
      }),
    ],
    when: { workspaceId: 'workspace-1' },
    expect: [
      {
        id: 'message-1',
        workspaceId: 'workspace-1',
        author: { type: 'user', displayName: 'Ada Lovelace' },
        content: 'Hello Specter',
      },
      {
        id: 'message-3',
        workspaceId: 'workspace-1',
        author: { type: 'agent', displayName: 'Specter', agentId: 'specter' },
        content: 'I can help.',
        parentMessageId: 'message-1',
      },
    ],
  })
  .handle(async (query, state) =>
    state.messages.filter((message) => message.workspaceId === query.workspaceId),
  )

export default chatMessagesQuery
