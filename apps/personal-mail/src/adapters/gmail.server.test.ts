import { expect, test } from 'vitest'

import { extractText, normalizeThread } from './gmail.server'

test('normalizes Gmail MIME and label state at the adapter boundary', () => {
  const bodyText = Buffer.from('Please review the build.').toString('base64url')
  expect(
    normalizeThread({
      id: 'thread-1',
      historyId: '102',
      messages: [
        {
          id: 'message-1',
          threadId: 'thread-1',
          historyId: '101',
          internalDate: '1784721600000',
          labelIds: ['INBOX', 'UNREAD'],
          snippet: 'Please review...',
          payload: {
            mimeType: 'multipart/alternative',
            headers: [
              { name: 'From', value: 'Ada <ada@example.com>' },
              { name: 'Subject', value: 'Review' },
            ],
            parts: [{ mimeType: 'text/plain', body: { data: bodyText } }],
          },
        },
      ],
    }),
  ).toEqual({
    threadId: 'thread-1',
    messageId: 'message-1',
    historyId: '102',
    sender: 'Ada <ada@example.com>',
    subject: 'Review',
    snippet: 'Please review...',
    bodyText: 'Please review the build.',
    receivedAt: new Date(1784721600000).toISOString(),
    unread: true,
    labels: ['INBOX', 'UNREAD'],
  })
})

test('strips executable HTML when plain text is unavailable', () => {
  const data = Buffer.from(
    '<style>.secret{display:none}</style><p>Hello <strong>Ada</strong></p><script>alert(1)</script>',
  ).toString('base64url')
  expect(extractText({ mimeType: 'text/html', body: { data } })).toBe(
    'Hello Ada',
  )
})
