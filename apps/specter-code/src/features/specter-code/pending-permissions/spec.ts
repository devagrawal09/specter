import { createQuerySlice, event } from '@specter-ts/core/spec'

const pendingPermissionsSpec = createQuerySlice('pendingPermissions')
  .description('Lists unresolved tool approval requests for a session.')
  .scenarios({
    description:
      'Lists only unresolved tool approval requests for the queried session.',
    given: [
      event('tool-approval-requested', {
        requestId: 'permission-request-1',
        sessionId: 'session-1',
        messageId: 'message-1',
        workspaceId: 'workspace-1',
        agentId: 'build',
        toolCallId: 'tool-call-1',
        toolName: 'shell',
        permission: 'shell.execute',
        target: 'pnpm test',
        reason: 'Shell command requires confirmation',
      }),
      event('tool-approval-requested', {
        requestId: 'permission-request-2',
        sessionId: 'session-1',
        messageId: 'message-2',
        workspaceId: 'workspace-1',
        agentId: 'build',
        toolCallId: 'tool-call-2',
        toolName: 'write',
        permission: 'file.write',
        target: 'src/index.ts',
      }),
      event('tool-approval-requested', {
        requestId: 'permission-request-other-session',
        sessionId: 'session-2',
        messageId: 'message-3',
        workspaceId: 'workspace-1',
        agentId: 'build',
        toolName: 'read',
        permission: 'file.read',
        target: 'README.md',
      }),
      event('tool-approval-replied', {
        requestId: 'permission-request-1',
        sessionId: 'session-1',
        action: 'allow',
        repliedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
      }),
    ],
    when: { sessionId: 'session-1' },
    expect: [
      {
        requestId: 'permission-request-2',
        sessionId: 'session-1',
        messageId: 'message-2',
        workspaceId: 'workspace-1',
        agentId: 'build',
        toolCallId: 'tool-call-2',
        toolName: 'write',
        permission: 'file.write',
        target: 'src/index.ts',
      },
    ],
  })

export default pendingPermissionsSpec
