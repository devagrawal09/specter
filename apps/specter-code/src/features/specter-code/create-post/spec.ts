import { createCommandSlice, event } from '@specter-ts/core/spec'

const createPostSpec = createCommandSlice('createPost')
  .description('Creates a top-level post in a workspace chat.')
  .scenarios(
    {
          description: 'Creates a trimmed user post in a workspace.',
          given: [],
          when: {
            postId: 'post-1',
            workspaceId: 'workspace-1',
            author: { userId: 'user-1', displayName: 'Ada Lovelace' },
            content: '  Can Specter inspect this workspace?  ',
          },
          expect: [
            event('post-created', {
              postId: 'post-1',
              workspaceId: 'workspace-1',
              author: {
                type: 'user',
                userId: 'user-1',
                displayName: 'Ada Lovelace',
              },
              content: 'Can Specter inspect this workspace?',
            }),
          ],
        },
    {
          description: 'Rejects a blank post body.',
          given: [],
          when: {
            postId: 'post-2',
            workspaceId: 'workspace-1',
            author: { displayName: 'Ada Lovelace' },
            content: '   ',
          },
          expect: [],
          reject: { reason: 'Post content is required' },
        }
  )

export default createPostSpec
