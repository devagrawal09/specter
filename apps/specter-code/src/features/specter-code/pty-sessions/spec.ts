import { createQuerySlice, event } from '@specter-ts/core/spec'

const ptySessionsSpec = createQuerySlice('ptySessions')
  .description('Lists terminal sessions and recent output for an OpenCode session.')
  .scenarios(
{
    description: 'Tracks running and ended PTY sessions for the queried OpenCode session.',
    given: [
      event('pty-session-started', {
        ptySessionId: 'pty-session-1',
        sessionId: 'session-pty-1',
        workspaceId: 'workspace-pty-1',
        cwd: '.',
        shell: '/bin/sh',
        startedAt: '2026-06-24T06:00:00.000Z',
      }),
      event('pty-session-output', {
        ptySessionId: 'pty-session-1',
        sessionId: 'session-pty-1',
        stream: 'stdout',
        data: 'hello from pty\n',
        sequence: 1,
        emittedAt: '2026-06-24T06:00:01.000Z',
      }),
      event('pty-session-ended', {
        ptySessionId: 'pty-session-1',
        sessionId: 'session-pty-1',
        exitCode: 0,
        signal: null,
        status: 'exited',
        endedAt: '2026-06-24T06:00:02.000Z',
      }),
      event('pty-session-started', {
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
  }
  )

export default ptySessionsSpec
