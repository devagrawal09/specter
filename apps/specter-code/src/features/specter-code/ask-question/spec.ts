import { createCommandSlice, event } from '@specter-ts/core/spec'

const askQuestionSpec = createCommandSlice('askQuestion')
  .description(
    'Records an OpenCode-style user question raised by an agent tool.',
  )
  .scenarios(
    {
      description:
        'Records a normalized pending question for a session message.',
      given: [],
      when: {
        questionId: 'question-1',
        sessionId: 'session-question-1',
        messageId: 'message-question-1',
        prompt: ' Which migration should I run? ',
        options: [
          { id: 'safe', label: ' Safe schema migration ' },
          { id: 'fast', label: 'Fast data-only migration' },
        ],
        allowFreeform: true,
      },
      expect: [
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
      ],
    },
    {
      description: 'Rejects empty prompts and empty option labels.',
      given: [],
      when: {
        questionId: 'question-invalid',
        sessionId: 'session-question-1',
        messageId: 'message-question-1',
        prompt: 'Choose one',
        options: [{ id: 'bad-option', label: '   ' }],
      },
      expect: [],
      reject: { reason: 'Question option label is required' },
    },
  )

export default askQuestionSpec
