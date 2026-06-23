import { createQuerySlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import {
  agentRunRequestedEvent,
  postReplyCreatedEvent,
  userMessageSubmittedEvent,
} from '../events'

type TranscriptItem = {
  id: string
  sessionId: string
  workspaceId: string
  role: 'user' | 'assistant'
  content: string
  author: {
    userId?: string
    agentId?: string
    displayName: string
  }
}

type SessionTranscriptState = {
  items: TranscriptItem[]
  messageSessions: Record<string, { sessionId: string; workspaceId: string }>
  runMessageIds: Record<string, string>
}

const sessionTranscript = createQuerySlice(
  'sessionTranscript',
  'Lists transcript items for a coding-agent session.',
)
  .schema(z.object({ sessionId: z.string() }))
  .store(
    createMemorySliceStore<SessionTranscriptState>(() => ({
      items: [],
      messageSessions: {},
      runMessageIds: {},
    })),
  )
  .apply({
    [userMessageSubmittedEvent.type]: async (event, state) => {
      const payload = await userMessageSubmittedEvent.decode(event.payload)

      state.messageSessions[payload.messageId] = {
        sessionId: payload.sessionId,
        workspaceId: payload.workspaceId,
      }

      if (state.items.some((item) => item.id === payload.messageId)) {
        return
      }

      state.items.push({
        id: payload.messageId,
        sessionId: payload.sessionId,
        workspaceId: payload.workspaceId,
        role: 'user',
        content: payload.content,
        author: payload.submittedBy,
      })
    },
    [agentRunRequestedEvent.type]: async (event, state) => {
      const payload = await agentRunRequestedEvent.decode(event.payload)
      if (payload.postId) state.runMessageIds[payload.runId] = payload.postId
    },
    [postReplyCreatedEvent.type]: async (event, state) => {
      const payload = await postReplyCreatedEvent.decode(event.payload)
      if (!payload.sourceRunId || payload.author.type !== 'agent') return

      const messageId =
        state.runMessageIds[payload.sourceRunId] ?? payload.parentPostId
      const session = state.messageSessions[messageId]
      if (!session) return

      if (state.items.some((item) => item.id === payload.replyId)) return

      state.items.push({
        id: payload.replyId,
        sessionId: session.sessionId,
        workspaceId: session.workspaceId,
        role: 'assistant',
        content: payload.content,
        author: {
          agentId: payload.author.agentId,
          displayName: payload.author.displayName,
        },
      })
    },
  })
  .scenarios(
    {
      description: 'Lists user messages for the requested session in submission order.',
      given: [
        userMessageSubmittedEvent.create({
          messageId: 'message-1',
          sessionId: 'session-1',
          workspaceId: 'workspace-1',
          content: 'add a test',
          submittedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
        }),
        userMessageSubmittedEvent.create({
          messageId: 'message-2',
          sessionId: 'session-2',
          workspaceId: 'workspace-1',
          content: 'other session',
          submittedBy: { displayName: 'Ada Lovelace' },
        }),
        userMessageSubmittedEvent.create({
          messageId: 'message-3',
          sessionId: 'session-1',
          workspaceId: 'workspace-1',
          content: 'run it',
          submittedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
        }),
      ],
      when: { sessionId: 'session-1' },
      expect: [
        {
          id: 'message-1',
          sessionId: 'session-1',
          workspaceId: 'workspace-1',
          role: 'user',
          content: 'add a test',
          author: { userId: 'user-1', displayName: 'Ada Lovelace' },
        },
        {
          id: 'message-3',
          sessionId: 'session-1',
          workspaceId: 'workspace-1',
          role: 'user',
          content: 'run it',
          author: { userId: 'user-1', displayName: 'Ada Lovelace' },
        },
      ],
    },
    {
      description: 'Includes assistant replies produced by runs for session prompts.',
      given: [
        userMessageSubmittedEvent.create({
          messageId: 'message-assistant-1',
          sessionId: 'session-assistant',
          workspaceId: 'workspace-1',
          content: 'add a test',
          submittedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
        }),
        agentRunRequestedEvent.create({
          runId: 'run-assistant-1',
          workspaceId: 'workspace-1',
          postId: 'message-assistant-1',
          agentId: 'build',
          agentName: 'Build Agent',
          requestedBy: { type: 'user', userId: 'user-1', displayName: 'Ada Lovelace' },
        }),
        postReplyCreatedEvent.create({
          replyId: 'reply-assistant-1',
          workspaceId: 'workspace-1',
          parentPostId: 'message-assistant-1',
          author: { type: 'agent', agentId: 'build', displayName: 'Build Agent' },
          content: 'I added the regression test.',
          sourceRunId: 'run-assistant-1',
        }),
      ],
      when: { sessionId: 'session-assistant' },
      expect: [
        {
          id: 'message-assistant-1',
          sessionId: 'session-assistant',
          workspaceId: 'workspace-1',
          role: 'user',
          content: 'add a test',
          author: { userId: 'user-1', displayName: 'Ada Lovelace' },
        },
        {
          id: 'reply-assistant-1',
          sessionId: 'session-assistant',
          workspaceId: 'workspace-1',
          role: 'assistant',
          content: 'I added the regression test.',
          author: { agentId: 'build', displayName: 'Build Agent' },
        },
      ],
    },
  )
  .handle(async (query, state) =>
    state.items.filter((item) => item.sessionId === query.sessionId),
  )

export default sessionTranscript
