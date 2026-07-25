import { createCommandSlice, event } from '@specter-ts/spec'

export default createCommandSlice('recordGmailThread')
  .description('Records a normalized Gmail thread snapshot as a durable fact.')
  .scenarios({
    description: 'Records every normalized field without inventing metadata.',
    given: [],
    when: {
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
    },
    expect: [
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
    ],
  })
