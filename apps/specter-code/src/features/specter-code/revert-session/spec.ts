import { createCommandSlice, event } from '@specter-ts/spec'

const revertSessionSpec = createCommandSlice('revertSession')
  .description('Requests a session file revert from captured tool snapshots.')
  .scenarios(
    {
      description: 'Requests reverting a session from captured file snapshots.',
      given: [],
      when: {
        revertId: 'revert-1',
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        snapshots: [
          {
            path: 'src/app.ts',
            existed: true,
            content: 'export const value = 1\n',
          },
          { path: 'src/generated.ts', existed: false },
        ],
        requestedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
        reason: 'Undo last tool changes',
      },
      expect: [
        event('session-revert-requested', {
          revertId: 'revert-1',
          sessionId: 'session-1',
          workspaceId: 'workspace-1',
          snapshots: [
            {
              path: 'src/app.ts',
              existed: true,
              content: 'export const value = 1\n',
            },
            { path: 'src/generated.ts', existed: false },
          ],
          requestedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
          reason: 'Undo last tool changes',
        }),
      ],
    },
    {
      description: 'Rejects revert requests without snapshots.',
      given: [],
      when: {
        revertId: 'revert-invalid',
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        snapshots: [],
      },
      expect: [],
      reject: {
        reason: 'At least one snapshot is required to revert a session',
      },
    },
  )

export default revertSessionSpec
