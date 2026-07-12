import ptySessionsSpec from './spec'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import {
  ptySessionEndedEvent,
  ptySessionOutputEvent,
  ptySessionStartedEvent,
} from '../events'

type PtySessionProjection = {
  id: string
  sessionId: string
  workspaceId: string
  cwd: string
  shell: string
  status: 'running' | 'exited' | 'killed'
  startedAt: string
  endedAt?: string
  lastOutputAt?: string
  outputPreview: string
}

type PtySessionsState = {
  sessions: Record<string, PtySessionProjection>
}

const MAX_OUTPUT_PREVIEW_LENGTH = 2000

const appendPreview = (current: string, data: string) => {
  const next = current + data
  if (next.length <= MAX_OUTPUT_PREVIEW_LENGTH) return next
  return next.slice(next.length - MAX_OUTPUT_PREVIEW_LENGTH)
}

const ptySessions = ptySessionsSpec
  .inputSchema(
    z.object({
      sessionId: z.string(),
    }),
  )
  .outputSchema<PtySessionProjection[]>()
  .store(createMemorySliceStore<PtySessionsState>(() => ({ sessions: {} })))
  .apply(ptySessionStartedEvent, async (event, state) => {
      const payload = event.payload
      state.sessions[payload.ptySessionId] = {
        id: payload.ptySessionId,
        sessionId: payload.sessionId,
        workspaceId: payload.workspaceId,
        cwd: payload.cwd,
        shell: payload.shell,
        status: 'running',
        startedAt: payload.startedAt,
        outputPreview: '',
      }
    })
  .apply(ptySessionOutputEvent, async (event, state) => {
      const payload = event.payload
      const session = state.sessions[payload.ptySessionId]
      if (!session) return
      session.outputPreview = appendPreview(session.outputPreview, payload.data)
      session.lastOutputAt = payload.emittedAt
    })
  .apply(ptySessionEndedEvent, async (event, state) => {
      const payload = event.payload
      const session = state.sessions[payload.ptySessionId]
      if (!session) return
      session.status = payload.status
      session.endedAt = payload.endedAt
    })
  
  .handle(async (query, state): Promise<PtySessionProjection[]> => {
    return Object.values(state.sessions)
      .filter((session) => session.sessionId === query.sessionId)
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
  })

export default ptySessions
