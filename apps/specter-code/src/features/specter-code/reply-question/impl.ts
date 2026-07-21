import replyQuestionSpec from './spec'
import { z } from 'zod'

import { defineMemorySliceStore } from '../../../testing/memory-slice-store'
import { questionAnsweredEvent } from '../events'

const replyQuestion = replyQuestionSpec
  .inputSchema(
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
  .store(defineMemorySliceStore(() => ({})))

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
