import { createCommandSlice, event } from '@specter-ts/spec'

const thread = event('gmail-thread-recorded', {
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
})

const requested = event('thread-analysis-requested', {
  analysisId: 'analysis-1',
  threadId: 'thread-1',
  provider: 'local',
  requestedAt: '2026-07-22T12:01:00.000Z',
})

export default createCommandSlice('requestThreadAnalysis')
  .description('Requests local analysis by default and gates every cloud use.')
  .scenarios(
    {
      description: 'Requests local analysis for a known Gmail thread.',
      given: [thread],
      when: {
        analysisId: 'analysis-1',
        threadId: 'thread-1',
        provider: 'local',
        cloudOptIn: false,
        requestedAt: '2026-07-22T12:01:00.000Z',
      },
      expect: [requested],
    },
    {
      description: 'Rejects cloud analysis without per-action opt-in.',
      given: [thread],
      when: {
        analysisId: 'analysis-cloud',
        threadId: 'thread-1',
        provider: 'cloud',
        cloudOptIn: false,
        requestedAt: '2026-07-22T12:01:00.000Z',
      },
      expect: [],
      reject: { reason: 'Cloud analysis requires explicit per-action opt-in' },
    },
    {
      description: 'Rejects a duplicate analysis while one is pending.',
      given: [thread, requested],
      when: {
        analysisId: 'analysis-2',
        threadId: 'thread-1',
        provider: 'local',
        cloudOptIn: false,
        requestedAt: '2026-07-22T12:01:30.000Z',
      },
      expect: [],
      reject: { reason: 'Thread analysis is already pending' },
    },
    {
      description: 'Allows a fresh analysis after the previous result.',
      given: [
        thread,
        requested,
        event('thread-analyzed', {
          analysisId: 'analysis-1',
          threadId: 'thread-1',
          provider: 'local',
          summary: 'A project update needs review.',
          priority: 'high',
          suggestedAction: 'reply',
          analyzedAt: '2026-07-22T12:01:10.000Z',
        }),
      ],
      when: {
        analysisId: 'analysis-2',
        threadId: 'thread-1',
        provider: 'cloud',
        cloudOptIn: true,
        requestedAt: '2026-07-22T12:02:00.000Z',
      },
      expect: [
        event('thread-analysis-requested', {
          analysisId: 'analysis-2',
          threadId: 'thread-1',
          provider: 'cloud',
          requestedAt: '2026-07-22T12:02:00.000Z',
        }),
      ],
    },
  )
