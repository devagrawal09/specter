import { createCommandSlice, event } from '@specter-ts/core/spec'

const replyToPostSpec = createCommandSlice('replyToPost')
  .description('Replies to an existing post in a workspace chat.')
  .scenarios(
    {
          description: 'Creates a trimmed user reply to an existing post.',
          given: [
            event('post-created', {
              postId: 'post-1',
              workspaceId: 'workspace-1',
              author: { type: 'user', displayName: 'Grace Hopper' },
              content: 'Can Specter inspect this?',
            }),
          ],
          when: {
            replyId: 'reply-1',
            workspaceId: 'workspace-1',
            parentPostId: 'post-1',
            author: { userId: 'user-1', displayName: 'Ada Lovelace' },
            content: '  Please check src/index.ts  ',
          },
          expect: [
            event('post-reply-created', {
              replyId: 'reply-1',
              workspaceId: 'workspace-1',
              parentPostId: 'post-1',
              author: {
                type: 'user',
                userId: 'user-1',
                displayName: 'Ada Lovelace',
              },
              content: 'Please check src/index.ts',
            }),
          ],
        },
    {
          description: 'Rejects a blank reply body.',
          given: [],
          when: {
            replyId: 'reply-2',
            workspaceId: 'workspace-1',
            parentPostId: 'post-1',
            author: { displayName: 'Ada Lovelace' },
            content: '   ',
          },
          expect: [],
          reject: { reason: 'Reply content is required' },
        }
  )

export default replyToPostSpec
