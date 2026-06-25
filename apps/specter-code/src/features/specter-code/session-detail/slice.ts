import { createQuerySlice } from '@specter-ts/core'
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

const sessionDetail = createQuerySlice(
  'sessionDetail',
  'Gets a single coding-agent session by id.',
)
  .schema(z.object({ sessionId: z.string() }))
  .store(createMemorySliceStore<SessionDetailState>(() => ({ sessions: {} })))
  .apply({
    [sessionCreatedEvent.type]: async (event, state) => {
      const payload = await sessionCreatedEvent.decode(event.payload)
      state.sessions[payload.sessionId] = {
        id: payload.sessionId,
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
  .scenarios(
    {
      description: 'Returns a created session by id.',
      given: [
        sessionCreatedEvent.create({
          sessionId: 'session-1',
          workspaceId: 'workspace-1',
          title: 'Fix tests',
          directory: '/tmp/project',
          agent: 'build',
          model: {
            providerId: 'openrouter',
            modelId: 'anthropic/claude-sonnet-4',
          },
        }),
      ],
      when: { sessionId: 'session-1' },
      expect: {
        id: 'session-1',
        workspaceId: 'workspace-1',
        title: 'Fix tests',
        directory: '/tmp/project',
        agent: 'build',
        model: {
          providerId: 'openrouter',
          modelId: 'anthropic/claude-sonnet-4',
        },
      },
    },
    {
      description:
        'Returns updated session metadata and hides deleted sessions.',
      given: [
        sessionCreatedEvent.create({
          sessionId: 'session-1',
          workspaceId: 'workspace-1',
          title: 'Fix tests',
          directory: '/tmp/project',
          agent: 'build',
          model: {
            providerId: 'openrouter',
            modelId: 'anthropic/claude-sonnet-4',
          },
        }),
        sessionUpdatedEvent.create({
          sessionId: 'session-1',
          title: 'Renamed session',
          agent: 'senior',
        }),
      ],
      when: { sessionId: 'session-1' },
      expect: {
        id: 'session-1',
        workspaceId: 'workspace-1',
        title: 'Renamed session',
        directory: '/tmp/project',
        agent: 'senior',
        model: {
          providerId: 'openrouter',
          modelId: 'anthropic/claude-sonnet-4',
        },
      },
    },
    {
      description: 'Returns null for a deleted session.',
      given: [
        sessionCreatedEvent.create({
          sessionId: 'session-1',
          workspaceId: 'workspace-1',
          title: 'Fix tests',
          directory: '/tmp/project',
          agent: 'build',
          model: {
            providerId: 'openrouter',
            modelId: 'anthropic/claude-sonnet-4',
          },
        }),
        sessionDeletedEvent.create({ sessionId: 'session-1' }),
      ],
      when: { sessionId: 'session-1' },
      expect: null,
    },
  )
  .handle(async (query, state) => state.sessions[query.sessionId] ?? null)

export default sessionDetail
