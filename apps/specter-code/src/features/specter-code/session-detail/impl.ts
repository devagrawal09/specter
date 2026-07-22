import specification from './spec.json' with { type: 'json' }
import { implementQuery } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import {
  sessionCreatedEvent,
  sessionDeletedEvent,
  sessionUpdatedEvent,
} from '../events'

type SessionDetail = {
  id: string
  workspaceId: string
  parentSessionId?: string
  title: string
  directory: string
  agent: string
  model: {
    providerId: string
    modelId: string
  }
  createdBy?: {
    userId?: string
    displayName: string
  }
}

type SessionDetailState = {
  sessions: Record<string, SessionDetail>
}

const sessionDetail = implementQuery<'sessionDetail'>(specification)
  .inputSchema(z.object({ sessionId: z.string() }))
  .outputSchema<SessionDetail | null>()
  .store(createMemorySliceStore<SessionDetailState>(() => ({ sessions: {} })))
  .apply(sessionCreatedEvent, async (event, state) => {
    const payload = event.payload
    state.sessions[payload.sessionId] = {
      id: payload.sessionId,
      workspaceId: payload.workspaceId,
      parentSessionId: payload.parentSessionId,
      title: payload.title,
      directory: payload.directory,
      agent: payload.agent,
      model: payload.model,
      createdBy: payload.createdBy,
    }
  })
  .apply(sessionUpdatedEvent, async (event, state) => {
    const payload = event.payload
    const session = state.sessions[payload.sessionId]
    if (!session) return
    if (payload.title !== undefined) session.title = payload.title
    if (payload.directory !== undefined) session.directory = payload.directory
    if (payload.agent !== undefined) session.agent = payload.agent
    if (payload.model !== undefined) session.model = payload.model
  })
  .apply(sessionDeletedEvent, async (event, state) => {
    const payload = event.payload
    delete state.sessions[payload.sessionId]
  })

  .handle(async (query, state) => state.sessions[query.sessionId] ?? null)

export default sessionDetail
