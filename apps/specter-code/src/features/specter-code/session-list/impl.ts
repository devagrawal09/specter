import sessionListSpec from './spec'
import { z } from 'zod'

import { defineMemorySliceStore } from '../../../testing/memory-slice-store'
import {
  sessionCreatedEvent,
  sessionDeletedEvent,
  sessionUpdatedEvent,
} from '../events'

type SessionListItem = {
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

type SessionListState = {
  sessions: SessionListItem[]
}

const sessionList = sessionListSpec
  .inputSchema(z.object({ workspaceId: z.string() }))
  .outputSchema<SessionListItem[]>()
  .store(defineMemorySliceStore<SessionListState>(() => ({ sessions: [] })))
  .apply(sessionCreatedEvent, async (event, state) => {
    const payload = event.payload

    if (state.sessions.some((session) => session.id === payload.sessionId)) {
      return
    }

    state.sessions.push({
      id: payload.sessionId,
      workspaceId: payload.workspaceId,
      parentSessionId: payload.parentSessionId,
      title: payload.title,
      directory: payload.directory,
      agent: payload.agent,
      model: payload.model,
      createdBy: payload.createdBy,
    })
  })
  .apply(sessionUpdatedEvent, async (event, state) => {
    const payload = event.payload
    const session = state.sessions.find(
      (candidate) => candidate.id === payload.sessionId,
    )
    if (!session) return
    if (payload.title !== undefined) session.title = payload.title
    if (payload.directory !== undefined) session.directory = payload.directory
    if (payload.agent !== undefined) session.agent = payload.agent
    if (payload.model !== undefined) session.model = payload.model
  })
  .apply(sessionDeletedEvent, async (event, state) => {
    const payload = event.payload
    state.sessions = state.sessions.filter(
      (session) => session.id !== payload.sessionId,
    )
  })

  .handle(async (query, state) =>
    state.sessions.filter(
      (session) => session.workspaceId === query.workspaceId,
    ),
  )

export default sessionList
