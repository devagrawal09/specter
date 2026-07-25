import { createCommandSlice, event } from '@specter-ts/spec'

export default createCommandSlice('recordGmailThreadRemoved')
  .description(
    'Records that Gmail no longer exposes a previously indexed thread.',
  )
  .scenarios({
    description:
      'Records the removed thread and Gmail history position exactly.',
    given: [],
    when: { threadId: 'thread-1', gmailHistoryId: '103' },
    expect: [
      event('gmail-thread-removed', {
        threadId: 'thread-1',
        gmailHistoryId: '103',
      }),
    ],
  })
