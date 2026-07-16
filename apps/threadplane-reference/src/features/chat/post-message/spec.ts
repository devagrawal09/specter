import { createCommandSlice, event } from '@specter-ts/core/spec'

const postMessageSpec = createCommandSlice('postMessage')
  .description('Posts a user message into a workspace chat.')
  .scenarios({
    description: 'Posts a trimmed user message.',
    given: [],
    when: {
      messageId: 'message-1',
      workspaceId: 'workspace-1',
      authorName: 'Ada Lovelace',
      content: '  Hello Specter  ',
    },
    expect: [
      event('message-posted', {
        messageId: 'message-1',
        workspaceId: 'workspace-1',
        author: { type: 'user', displayName: 'Ada Lovelace' },
        content: 'Hello Specter',
      }),
    ],
  })

export default postMessageSpec
