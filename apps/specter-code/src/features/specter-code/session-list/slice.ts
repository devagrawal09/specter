import { createQuerySlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
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

const sessionList = createQuerySlice(
  'sessionList',
  'Lists coding-agent sessions for a workspace.',
)
  .schema(z.object({ workspaceId: z.string() }))
  .store(createMemorySliceStore<SessionListState>(() => ({ sessions: [] })))
  .apply({
    [sessionCreatedEvent.type]: async (event, state) => {
      const payload = await sessionCreatedEvent.decode(event.payload)

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
    },
    [sessionUpdatedEvent.type]: async (event, state) => {
      const payload = await sessionUpdatedEvent.decode(event.payload)
      const session = state.sessions.find(
        (candidate) => candidate.id === payload.sessionId,
      )
      if (!session) return
      if (payload.title !== undefined) session.title = payload.title
      if (payload.directory !== undefined) session.directory = payload.directory
      if (payload.agent !== undefined) session.agent = payload.agent
      if (payload.model !== undefined) session.model = payload.model
    },
    [sessionDeletedEvent.type]: async (event, state) => {
      const payload = await sessionDeletedEvent.decode(event.payload)
      state.sessions = state.sessions.filter(
        (session) => session.id !== payload.sessionId,
      )
    },
  })
  .scenarios(
    {
      description:
        'Lists sessions for the requested workspace in creation order.',
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
        sessionCreatedEvent.create({
          sessionId: 'session-2',
          workspaceId: 'workspace-2',
          title: 'Other workspace',
          directory: '/tmp/other',
          agent: 'plan',
          model: { providerId: 'openai', modelId: 'gpt-5.1' },
        }),
        sessionCreatedEvent.create({
          sessionId: 'session-3',
          workspaceId: 'workspace-1',
          title: 'Implement shell tool',
          directory: '/tmp/project',
          agent: 'build',
          model: {
            providerId: 'openrouter',
            modelId: 'anthropic/claude-sonnet-4',
          },
        }),
      ],
      when: { workspaceId: 'workspace-1' },
      expect: [
        {
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
        {
          id: 'session-3',
          workspaceId: 'workspace-1',
          title: 'Implement shell tool',
          directory: '/tmp/project',
          agent: 'build',
          model: {
            providerId: 'openrouter',
            modelId: 'anthropic/claude-sonnet-4',
          },
        },
      ],
    },
    {
      description: 'Lists updated sessions and hides deleted sessions.',
      given: [
        sessionCreatedEvent.create({
          sessionId: 'session-update-1',
          workspaceId: 'workspace-update',
          title: 'Fix tests',
          directory: '/tmp/project',
          agent: 'build',
          model: {
            providerId: 'openrouter',
            modelId: 'anthropic/claude-sonnet-4',
          },
        }),
        sessionCreatedEvent.create({
          sessionId: 'session-update-2',
          workspaceId: 'workspace-update',
          title: 'Delete me',
          directory: '/tmp/project',
          agent: 'build',
          model: {
            providerId: 'openrouter',
            modelId: 'anthropic/claude-sonnet-4',
          },
        }),
        sessionUpdatedEvent.create({
          sessionId: 'session-update-1',
          title: 'Renamed session',
          model: { providerId: 'anthropic', modelId: 'claude-opus-4.1' },
        }),
        sessionDeletedEvent.create({ sessionId: 'session-update-2' }),
      ],
      when: { workspaceId: 'workspace-update' },
      expect: [
        {
          id: 'session-update-1',
          workspaceId: 'workspace-update',
          title: 'Renamed session',
          directory: '/tmp/project',
          agent: 'build',
          model: { providerId: 'anthropic', modelId: 'claude-opus-4.1' },
        },
      ],
    },
  )
  .handle(async (query, state) =>
    state.sessions.filter(
      (session) => session.workspaceId === query.workspaceId,
    ),
  )

export default sessionList
