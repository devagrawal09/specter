import { createCommandSlice, event } from '@specter-ts/core/spec'

const replyToolApprovalSpec = createCommandSlice('replyToolApproval')
  .description('Records the user decision for a pending tool approval request.')
  .scenarios({
    description: 'Records an allow decision for a pending tool approval.',
    given: [],
    when: {
      requestId: 'permission-request-1',
      sessionId: 'session-1',
      action: 'allow',
      repliedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
      reason: 'Known safe command',
    },
    expect: [
      event('tool-approval-replied', {
        requestId: 'permission-request-1',
        sessionId: 'session-1',
        action: 'allow',
        repliedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
        reason: 'Known safe command',
      }),
    ],
  })

export default replyToolApprovalSpec
