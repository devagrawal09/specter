import { createQuerySlice, event } from '@specter-ts/core/spec'

const chatMessagesQuerySpec = createQuerySlice('chatMessagesQuery')
  .description('Lists chat messages for a workspace.')
  .scenarios({
    description: 'Lists workspace messages in posting order.',
    given: [
      event('message-posted', {
        messageId: 'message-1',
        workspaceId: 'workspace-1',
        author: { type: 'user', displayName: 'Ada Lovelace' },
        content: 'Hello Specter',
      }),
      event('message-posted', {
        messageId: 'message-2',
        workspaceId: 'workspace-2',
        author: { type: 'user', displayName: 'Grace Hopper' },
        content: 'Wrong workspace',
      }),
      event('message-posted', {
        messageId: 'message-3',
        workspaceId: 'workspace-1',
        author: { type: 'agent', displayName: 'Specter', agentId: 'specter' },
        content: 'I can help.',
        parentMessageId: 'message-1',
      }),
    ],
    when: { workspaceId: 'workspace-1' },
    expect: [
      {
        id: 'message-1',
        workspaceId: 'workspace-1',
        author: { type: 'user', displayName: 'Ada Lovelace' },
        content: 'Hello Specter',
      },
      {
        id: 'message-3',
        workspaceId: 'workspace-1',
        author: { type: 'agent', displayName: 'Specter', agentId: 'specter' },
        content: 'I can help.',
        parentMessageId: 'message-1',
      },
    ],
  })

export default chatMessagesQuerySpec
