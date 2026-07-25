import { createReactionSlice, event } from '@specter-ts/spec'

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

export default createReactionSlice('analyzeThreadReaction')
  .description(
    'Runs pending AI analysis through the explicitly selected provider.',
  )
  .scenarios(
    {
      description:
        'Analyzes the oldest pending request with normalized thread content.',
      given: [thread, requested],
      expect: [
        {
          type: 'analyzeThread',
          payload: {
            analysisId: 'analysis-1',
            threadId: 'thread-1',
            provider: 'local',
            sender: 'Ada <ada@example.com>',
            subject: 'Project update',
            bodyText: 'The build is ready for review.',
          },
        },
      ],
    },
    {
      description: 'Does not analyze a completed request again.',
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
      expect: [],
    },
  )
