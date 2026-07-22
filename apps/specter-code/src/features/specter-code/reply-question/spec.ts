import { createCommandSlice, event } from '@specter-ts/spec'

const replyQuestionSpec = createCommandSlice('replyQuestion')
  .description('Records the user answer for a pending OpenCode-style question.')
  .scenarios(
    {
      description: 'Records a normalized answer for a pending question.',
      given: [],
      when: {
        questionId: 'question-1',
        sessionId: 'session-question-1',
        answer: ' Use the safe migration ',
        answeredBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
      },
      expect: [
        event('question-answered', {
          questionId: 'question-1',
          sessionId: 'session-question-1',
          answer: 'Use the safe migration',
          answeredBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
        }),
      ],
    },
    {
      description: 'Rejects empty answers.',
      given: [],
      when: {
        questionId: 'question-1',
        sessionId: 'session-question-1',
        answer: '   ',
      },
      expect: [],
      reject: { reason: 'Question answer is required' },
    },
  )

export default replyQuestionSpec
