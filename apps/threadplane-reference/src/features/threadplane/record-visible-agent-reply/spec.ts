import { createCommandSlice, event } from '@specter-ts/spec'

const recordVisibleAgentReplySpec = createCommandSlice(
  'recordVisibleAgentReply',
)
  .description(
    'Records an Agent Run response as a visible reply in the workspace chat.',
  )
  .scenarios(
    {
      description: 'Records a completed Agent Run as a visible agent reply.',
      given: [],
      when: {
        replyId: 'reply-1',
        workspaceId: 'workspace-1',
        parentPostId: 'post-1',
        runId: 'run-1',
        agentId: 'specter',
        agentName: 'Specter',
        content: 'I found the failing test.',
      },
      expect: [
        event('post-reply-created', {
          replyId: 'reply-1',
          workspaceId: 'workspace-1',
          parentPostId: 'post-1',
          author: {
            type: 'agent',
            agentId: 'specter',
            displayName: 'Specter',
          },
          content: 'I found the failing test.',
          sourceRunId: 'run-1',
        }),
      ],
    },
    {
      description: 'Rejects a blank visible agent reply.',
      given: [],
      when: {
        replyId: 'reply-2',
        workspaceId: 'workspace-1',
        parentPostId: 'post-1',
        runId: 'run-1',
        agentId: 'specter',
        agentName: 'Specter',
        content: '   ',
      },
      expect: [],
      reject: { reason: 'Agent reply content is required' },
    },
  )

export default recordVisibleAgentReplySpec
