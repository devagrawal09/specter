import { createQuerySlice, event } from '@specter-ts/spec'

const pendingQuestionsSpec = createQuerySlice('pendingQuestions')
  .description(
    'Lists unresolved OpenCode-style questions for a session or all sessions.',
  )
  .scenarios({
    description: 'Lists only unresolved questions for the queried session.',
    given: [
      event('question-asked', {
        questionId: 'question-1',
        sessionId: 'session-question-1',
        messageId: 'message-question-1',
        prompt: 'Which migration should I run?',
        options: [
          { id: 'safe', label: 'Safe schema migration' },
          { id: 'fast', label: 'Fast data-only migration' },
        ],
        allowFreeform: true,
      }),
      event('question-asked', {
        questionId: 'question-2',
        sessionId: 'session-question-1',
        messageId: 'message-question-2',
        prompt: 'Should I run tests now?',
        options: [],
        allowFreeform: true,
      }),
      event('question-asked', {
        questionId: 'question-other-session',
        sessionId: 'session-question-2',
        messageId: 'message-question-other',
        prompt: 'Ignore this?',
        options: [],
        allowFreeform: true,
      }),
      event('question-answered', {
        questionId: 'question-1',
        sessionId: 'session-question-1',
        answer: 'Use the safe migration',
        answeredBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
      }),
    ],
    when: { sessionId: 'session-question-1' },
    expect: [
      {
        questionId: 'question-2',
        sessionId: 'session-question-1',
        messageId: 'message-question-2',
        prompt: 'Should I run tests now?',
        options: [],
        allowFreeform: true,
      },
    ],
  })

export default pendingQuestionsSpec
