import { createQuerySlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { sessionCreatedEvent } from '../events'

type SessionListItem = {
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
        title: payload.title,
        directory: payload.directory,
        agent: payload.agent,
        model: payload.model,
        createdBy: payload.createdBy,
      })
    },
  })
  .scenarios({
    description: 'Lists sessions for the requested workspace in creation order.',
    given: [
      sessionCreatedEvent.create({
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        title: 'Fix tests',
        directory: '/tmp/project',
        agent: 'build',
        model: { providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4' },
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
        model: { providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4' },
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
        model: { providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4' },
      },
      {
        id: 'session-3',
        workspaceId: 'workspace-1',
        title: 'Implement shell tool',
        directory: '/tmp/project',
        agent: 'build',
        model: { providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4' },
      },
    ],
  })
  .handle(async (query, state) =>
    state.sessions.filter((session) => session.workspaceId === query.workspaceId),
  )

export default sessionList
