import { createReactionSlice, event } from '@specter-ts/core/spec'

const simulatedAgentReplyReactionSpec = createReactionSlice(
  'simulatedAgentReplyReaction',
)
  .description(
    'Requests a deterministic agent reply when Specter is mentioned.',
  )
  .scenarios({
    description: 'Requests an agent reply when Specter is mentioned.',
    given: [
      event('message-posted', {
        messageId: 'message-1',
        workspaceId: 'workspace-1',
        author: { type: 'user', displayName: 'Ada Lovelace' },
        content: 'Can @specter help with this?',
      }),
    ],
    expect: [
      {
        type: 'recordAgentReply',
        payload: {
          messageId: 'message-1-reply',
          workspaceId: 'workspace-1',
          replyToMessageId: 'message-1',
          agentId: 'specter',
          agentName: 'Specter',
          content: 'Specter heard: Can @specter help with this?',
        },
      },
    ],
  })

export default simulatedAgentReplyReactionSpec
