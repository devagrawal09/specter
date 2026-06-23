import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { questionAnsweredEvent } from '../events'

const replyQuestion = createCommandSlice(
  'replyQuestion',
  'Records the user answer for a pending OpenCode-style question.',
)
  .schema(
    z.object({
      questionId: z.string(),
      sessionId: z.string(),
      answer: z.string(),
      answeredBy: z
        .object({
          userId: z.string().optional(),
          displayName: z.string(),
        })
        .optional(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
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
        questionAnsweredEvent.create({
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
  .handle(async (command) => {
    const answer = command.answer.trim()
    if (!answer) throw new Error('Question answer is required')

    return [
      questionAnsweredEvent.create({
        questionId: command.questionId,
        sessionId: command.sessionId,
        answer,
        answeredBy: command.answeredBy,
      }),
    ]
  })

export default replyQuestion
