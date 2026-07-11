import { createCommandSlice, event } from '@specter-ts/core/spec'

const requestToolApprovalSpec = createCommandSlice('requestToolApproval')
  .description('Records that an agent tool execution is waiting for user approval.')
  .scenarios(
{
      description: 'Requests approval before a gated tool executes.',
      given: [],
      when: {
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
      },
      expect: [
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
      ],
    },
    {
      description: 'Rejects approval requests without a permission or target.',
      given: [],
      when: {
        requestId: 'permission-request-invalid',
        sessionId: 'session-1',
        messageId: 'message-1',
        workspaceId: 'workspace-1',
        agentId: 'build',
        toolName: 'write',
        permission: '   ',
        target: '   ',
      },
      expect: [],
      reject: { reason: 'Permission and target are required' },
    },
  )

export default requestToolApprovalSpec
