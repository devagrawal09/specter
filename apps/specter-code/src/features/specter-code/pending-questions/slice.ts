import { createQuerySlice } from '@specter-ts/core'
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

const pendingQuestions = createQuerySlice(
  'pendingQuestions',
  'Lists unresolved OpenCode-style questions for a session or all sessions.',
)
  .schema(
    z.object({
      sessionId: z.string().optional(),
    }),
  )
  .store(createMemorySliceStore<PendingQuestionsState>(() => ({ pending: {} })))
  .apply({
    [questionAskedEvent.type]: async (event, state) => {
      const payload = await questionAskedEvent.decode(event.payload)
      state.pending[payload.questionId] = {
        questionId: payload.questionId,
        sessionId: payload.sessionId,
        messageId: payload.messageId,
        prompt: payload.prompt,
        options: payload.options.map((option) => ({ ...option })),
        allowFreeform: payload.allowFreeform,
      }
    },
    [questionAnsweredEvent.type]: async (event, state) => {
      const payload = await questionAnsweredEvent.decode(event.payload)
      delete state.pending[payload.questionId]
    },
  })
  .scenarios({
    description: 'Lists only unresolved questions for the queried session.',
    given: [
      questionAskedEvent.create({
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
      questionAskedEvent.create({
        questionId: 'question-2',
        sessionId: 'session-question-1',
        messageId: 'message-question-2',
        prompt: 'Should I run tests now?',
        options: [],
        allowFreeform: true,
      }),
      questionAskedEvent.create({
        questionId: 'question-other-session',
        sessionId: 'session-question-2',
        messageId: 'message-question-other',
        prompt: 'Ignore this?',
        options: [],
        allowFreeform: true,
      }),
      questionAnsweredEvent.create({
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
  .handle(async (query, state): Promise<PendingQuestion[]> => {
    const questions = Object.values(state.pending)
    if (!query.sessionId) return questions
    return questions.filter((question) => question.sessionId === query.sessionId)
  })

export default pendingQuestions
