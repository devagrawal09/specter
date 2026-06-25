import { createQuerySlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import {
  sessionCreatedEvent,
  sessionDeletedEvent,
  sessionUpdatedEvent,
} from '../events'

type SessionChild = {
  id: string
  parentSessionId: string
  workspaceId: string
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

type SessionChildrenState = {
  sessions: Record<string, SessionChild>
}

const sessionChildren = createQuerySlice(
  'sessionChildren',
  'Lists child sessions forked from a parent session.',
)
  .schema(z.object({ sessionId: z.string() }))
  .store(createMemorySliceStore<SessionChildrenState>(() => ({ sessions: {} })))
  .apply({
    [sessionCreatedEvent.type]: async (event, state) => {
      const payload = await sessionCreatedEvent.decode(event.payload)
      if (!payload.parentSessionId) return
      state.sessions[payload.sessionId] = {
        id: payload.sessionId,
        parentSessionId: payload.parentSessionId,
        workspaceId: payload.workspaceId,
        title: payload.title,
        directory: payload.directory,
        agent: payload.agent,
        model: payload.model,
        createdBy: payload.createdBy,
      }
    },
    [sessionUpdatedEvent.type]: async (event, state) => {
      const payload = await sessionUpdatedEvent.decode(event.payload)
      const session = state.sessions[payload.sessionId]
      if (!session) return
      if (payload.title !== undefined) session.title = payload.title
      if (payload.directory !== undefined) session.directory = payload.directory
      if (payload.agent !== undefined) session.agent = payload.agent
      if (payload.model !== undefined) session.model = payload.model
    },
    [sessionDeletedEvent.type]: async (event, state) => {
      const payload = await sessionDeletedEvent.decode(event.payload)
      delete state.sessions[payload.sessionId]
    },
  })
  .scenarios({
    description: 'Lists non-deleted children for the requested parent session.',
    given: [
      sessionCreatedEvent.create({
        sessionId: 'session-parent',
        workspaceId: 'workspace-1',
        title: 'Parent',
        directory: '/tmp/project',
        agent: 'build',
        model: { providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4' },
      }),
      sessionCreatedEvent.create({
        sessionId: 'session-child-1',
        parentSessionId: 'session-parent',
        workspaceId: 'workspace-1',
        title: 'Child one',
        directory: '/tmp/project',
        agent: 'build',
        model: { providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4' },
      }),
      sessionCreatedEvent.create({
        sessionId: 'session-child-2',
        parentSessionId: 'session-parent',
        workspaceId: 'workspace-1',
        title: 'Child two',
        directory: '/tmp/project',
        agent: 'build',
        model: { providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4' },
      }),
      sessionCreatedEvent.create({
        sessionId: 'session-other-child',
        parentSessionId: 'session-other-parent',
        workspaceId: 'workspace-1',
        title: 'Other child',
        directory: '/tmp/project',
        agent: 'build',
        model: { providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4' },
      }),
      sessionUpdatedEvent.create({
        sessionId: 'session-child-1',
        title: 'Renamed child',
      }),
      sessionDeletedEvent.create({ sessionId: 'session-child-2' }),
    ],
    when: { sessionId: 'session-parent' },
    expect: [
      {
        id: 'session-child-1',
        parentSessionId: 'session-parent',
        workspaceId: 'workspace-1',
        title: 'Renamed child',
        directory: '/tmp/project',
        agent: 'build',
        model: { providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4' },
      },
    ],
  })
  .handle(async (query, state): Promise<SessionChild[]> =>
    Object.values(state.sessions).filter(
      (session) => session.parentSessionId === query.sessionId,
    ),
  )

export default sessionChildren
