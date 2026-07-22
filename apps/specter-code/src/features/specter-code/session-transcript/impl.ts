import specification from './spec.json' with { type: 'json' }
import { implementQuery } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import {
  agentRunRequestedEvent,
  postReplyCreatedEvent,
  sessionMessageDeletedEvent,
  sessionMessagePartDeletedEvent,
  sessionMessagePartUpdatedEvent,
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

const sessionTranscript = implementQuery<'sessionTranscript'>(specification)
  .inputSchema(z.object({ sessionId: z.string() }))
  .outputSchema<TranscriptItem[]>()
  .store(
    createMemorySliceStore<SessionTranscriptState>(() => ({
      items: [],
      messageSessions: {},
      runMessageIds: {},
    })),
  )
  .apply(userMessageSubmittedEvent, async (event, state) => {
    const payload = event.payload

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
  })
  .apply(agentRunRequestedEvent, async (event, state) => {
    const payload = event.payload
    if (payload.postId) state.runMessageIds[payload.runId] = payload.postId
  })
  .apply(postReplyCreatedEvent, async (event, state) => {
    const payload = event.payload
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
  })
  .apply(sessionMessagePartUpdatedEvent, async (event, state) => {
    const payload = event.payload
    const item = state.items.find(
      (candidate) =>
        candidate.sessionId === payload.sessionId &&
        candidate.id === payload.messageId,
    )
    if (item) item.content = payload.content
  })
  .apply(sessionMessagePartDeletedEvent, async (event, state) => {
    const payload = event.payload
    const item = state.items.find(
      (candidate) =>
        candidate.sessionId === payload.sessionId &&
        candidate.id === payload.messageId,
    )
    if (item) item.content = ''
  })
  .apply(sessionMessageDeletedEvent, async (event, state) => {
    const payload = event.payload
    state.items = state.items.filter(
      (item) =>
        item.sessionId !== payload.sessionId || item.id !== payload.messageId,
    )
    delete state.messageSessions[payload.messageId]
  })

  .handle(async (query, state) =>
    state.items.filter((item) => item.sessionId === query.sessionId),
  )

export default sessionTranscript
