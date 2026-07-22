import specification from './spec.json' with { type: 'json' }
import { implementQuery } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { questionAnsweredEvent, questionAskedEvent } from '../events'

type PendingQuestionOption = {
  id: string
  label: string
}

type PendingQuestion = {
  questionId: string
  sessionId: string
  messageId: string
  prompt: string
  options: PendingQuestionOption[]
  allowFreeform: boolean
}

type PendingQuestionsState = {
  pending: Record<string, PendingQuestion>
}

const pendingQuestions = implementQuery<'pendingQuestions'>(specification)
  .inputSchema(
    z.object({
      sessionId: z.string().optional(),
    }),
  )
  .outputSchema<PendingQuestion[]>()
  .store(createMemorySliceStore<PendingQuestionsState>(() => ({ pending: {} })))
  .apply(questionAskedEvent, async (event, state) => {
    const payload = event.payload
    state.pending[payload.questionId] = {
      questionId: payload.questionId,
      sessionId: payload.sessionId,
      messageId: payload.messageId,
      prompt: payload.prompt,
      options: payload.options.map((option) => ({ ...option })),
      allowFreeform: payload.allowFreeform,
    }
  })
  .apply(questionAnsweredEvent, async (event, state) => {
    const payload = event.payload
    delete state.pending[payload.questionId]
  })

  .handle(async (query, state): Promise<PendingQuestion[]> => {
    const questions = Object.values(state.pending)
    if (!query.sessionId) return questions
    return questions.filter(
      (question) => question.sessionId === query.sessionId,
    )
  })

export default pendingQuestions
