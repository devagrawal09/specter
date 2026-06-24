import { createQuerySlice } from '@specter-ts/core'
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

const ptySessions = createQuerySlice(
  'ptySessions',
  'Lists terminal sessions and recent output for an OpenCode session.',
)
  .schema(
    z.object({
      sessionId: z.string(),
    }),
  )
  .store(createMemorySliceStore<PtySessionsState>(() => ({ sessions: {} })))
  .apply({
    [ptySessionStartedEvent.type]: async (event, state) => {
      const payload = await ptySessionStartedEvent.decode(event.payload)
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
    },
    [ptySessionOutputEvent.type]: async (event, state) => {
      const payload = await ptySessionOutputEvent.decode(event.payload)
      const session = state.sessions[payload.ptySessionId]
      if (!session) return
      session.outputPreview = appendPreview(session.outputPreview, payload.data)
      session.lastOutputAt = payload.emittedAt
    },
    [ptySessionEndedEvent.type]: async (event, state) => {
      const payload = await ptySessionEndedEvent.decode(event.payload)
      const session = state.sessions[payload.ptySessionId]
      if (!session) return
      session.status = payload.status
      session.endedAt = payload.endedAt
    },
  })
  .scenarios({
    description: 'Tracks running and ended PTY sessions for the queried OpenCode session.',
    given: [
      ptySessionStartedEvent.create({
        ptySessionId: 'pty-session-1',
        sessionId: 'session-pty-1',
        workspaceId: 'workspace-pty-1',
        cwd: '.',
        shell: '/bin/sh',
        startedAt: '2026-06-24T06:00:00.000Z',
      }),
      ptySessionOutputEvent.create({
        ptySessionId: 'pty-session-1',
        sessionId: 'session-pty-1',
        stream: 'stdout',
        data: 'hello from pty\n',
        sequence: 1,
        emittedAt: '2026-06-24T06:00:01.000Z',
      }),
      ptySessionEndedEvent.create({
        ptySessionId: 'pty-session-1',
        sessionId: 'session-pty-1',
        exitCode: 0,
        signal: null,
        status: 'exited',
        endedAt: '2026-06-24T06:00:02.000Z',
      }),
      ptySessionStartedEvent.create({
        ptySessionId: 'pty-session-other',
        sessionId: 'session-pty-other',
        workspaceId: 'workspace-pty-1',
        cwd: '.',
        shell: '/bin/sh',
        startedAt: '2026-06-24T06:00:03.000Z',
      }),
    ],
    when: { sessionId: 'session-pty-1' },
    expect: [
      {
        id: 'pty-session-1',
        sessionId: 'session-pty-1',
        workspaceId: 'workspace-pty-1',
        cwd: '.',
        shell: '/bin/sh',
        status: 'exited',
        startedAt: '2026-06-24T06:00:00.000Z',
        endedAt: '2026-06-24T06:00:02.000Z',
        lastOutputAt: '2026-06-24T06:00:01.000Z',
        outputPreview: 'hello from pty\n',
      },
    ],
  })
  .handle(async (query, state): Promise<PtySessionProjection[]> => {
    return Object.values(state.sessions)
      .filter((session) => session.sessionId === query.sessionId)
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
  })

export default ptySessions
