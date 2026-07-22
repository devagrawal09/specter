import { createQuerySlice, event } from '@specter-ts/spec'

const workspaceChatSpec = createQuerySlice('workspaceChat')
  .description('Shows posts and replies in a workspace chat.')
  .scenarios({
    description:
      'Lists workspace posts, user replies, and visible agent replies in posting order.',
    given: [
      event('post-created', {
        postId: 'post-1',
        workspaceId: 'workspace-1',
        author: { type: 'user', userId: 'user-1', displayName: 'Ada' },
        content: 'Can Specter inspect this workspace?',
      }),
      event('post-created', {
        postId: 'post-2',
        workspaceId: 'workspace-2',
        author: { type: 'user', displayName: 'Grace' },
        content: 'Wrong workspace',
      }),
      event('post-reply-created', {
        replyId: 'reply-1',
        workspaceId: 'workspace-1',
        parentPostId: 'post-1',
        author: { type: 'user', displayName: 'Grace' },
        content: 'Please check src/index.ts.',
      }),
      event('post-reply-created', {
        replyId: 'reply-2',
        workspaceId: 'workspace-1',
        parentPostId: 'post-1',
        author: { type: 'agent', agentId: 'specter', displayName: 'Specter' },
        content: 'I found a failing test.',
        sourceRunId: 'run-1',
      }),
    ],
    when: { workspaceId: 'workspace-1' },
    expect: [
      {
        id: 'post-1',
        workspaceId: 'workspace-1',
        author: { type: 'user', userId: 'user-1', displayName: 'Ada' },
        content: 'Can Specter inspect this workspace?',
      },
      {
        id: 'reply-1',
        workspaceId: 'workspace-1',
        parentPostId: 'post-1',
        author: { type: 'user', displayName: 'Grace' },
        content: 'Please check src/index.ts.',
      },
      {
        id: 'reply-2',
        workspaceId: 'workspace-1',
        parentPostId: 'post-1',
        author: { type: 'agent', agentId: 'specter', displayName: 'Specter' },
        content: 'I found a failing test.',
        sourceRunId: 'run-1',
      },
    ],
  })

export default workspaceChatSpec
