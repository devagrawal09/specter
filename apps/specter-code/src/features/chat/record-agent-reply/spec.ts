import { createCommandSlice, event } from '@specter-ts/core/spec'

const recordAgentReplySpec = createCommandSlice('recordAgentReply')
  .description('Records a simulated agent reply in a workspace chat.')
  .scenarios(
    {
        description: 'Records an agent reply beneath the triggering message.',
        given: [],
        when: {
          messageId: 'message-2',
          workspaceId: 'workspace-1',
          replyToMessageId: 'message-1',
          agentId: 'specter',
          agentName: 'Specter',
          content: 'I can help with that.',
        },
        expect: [
          event('message-posted', {
            messageId: 'message-2',
            workspaceId: 'workspace-1',
            author: {
              type: 'agent',
              displayName: 'Specter',
              agentId: 'specter',
            },
            content: 'I can help with that.',
            parentMessageId: 'message-1',
          }),
        ],
      }
  )

export default recordAgentReplySpec
