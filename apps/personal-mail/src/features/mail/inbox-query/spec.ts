import { createQuerySlice, event } from '@specter-ts/spec'

export default createQuerySlice('inboxQuery')
  .description('Projects Gmail thread snapshots with the latest AI analysis.')
  .scenarios({
    description: 'Shows a confirmed action and the latest structured analysis.',
    given: [
      event('gmail-thread-recorded', {
        threadId: 'thread-1',
        messageId: 'message-1',
        historyId: '101',
        sender: 'Ada <ada@example.com>',
        subject: 'Project update',
        snippet: 'The build is ready.',
        bodyText: 'The build is ready for review.',
        receivedAt: '2026-07-22T12:00:00.000Z',
        unread: true,
        labels: ['INBOX', 'UNREAD'],
      }),
      event('thread-analyzed', {
        analysisId: 'analysis-1',
        threadId: 'thread-1',
        provider: 'local',
        summary: 'A project update needs review.',
        priority: 'high',
        suggestedAction: 'reply',
        analyzedAt: '2026-07-22T12:01:00.000Z',
      }),
      event('mailbox-action-applied', {
        actionId: 'action-1',
        threadId: 'thread-1',
        action: 'markRead',
        gmailHistoryId: '102',
        appliedAt: '2026-07-22T12:04:00.000Z',
      }),
    ],
    when: { filter: 'all', search: '' },
    expect: [
      {
        threadId: 'thread-1',
        messageId: 'message-1',
        historyId: '102',
        sender: 'Ada <ada@example.com>',
        subject: 'Project update',
        snippet: 'The build is ready.',
        bodyText: 'The build is ready for review.',
        receivedAt: '2026-07-22T12:00:00.000Z',
        unread: false,
        labels: ['INBOX'],
        analysis: {
          analysisId: 'analysis-1',
          provider: 'local',
          summary: 'A project update needs review.',
          priority: 'high',
          suggestedAction: 'reply',
        },
      },
    ],
  })
