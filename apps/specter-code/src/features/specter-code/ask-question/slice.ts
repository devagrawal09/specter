import { createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { questionAskedEvent } from '../events'

const questionOptionSchema = z.object({
  id: z.string().optional(),
  label: z.string(),
})

const askQuestion = createCommandSlice(
  'askQuestion',
  'Records an OpenCode-style user question raised by an agent tool.',
)
  .schema(
    z.object({
      questionId: z.string().optional(),
      sessionId: z.string(),
      messageId: z.string(),
      prompt: z.string(),
      options: z.array(questionOptionSchema).optional(),
      allowFreeform: z.boolean().optional(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .scenarios(
    {
      description: 'Records a normalized pending question for a session message.',
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
      ],
    },
    {
      description: 'Rejects empty prompts and empty option labels.',
      given: [],
      when: {
        sessionId: 'session-question-1',
        messageId: 'message-question-1',
        prompt: 'Choose one',
        options: [{ id: 'bad-option', label: '   ' }],
      },
      expect: [],
      reject: { reason: 'Question option label is required' },
    },
  )
  .handle(async (command) => {
    const prompt = command.prompt.trim()
    if (!prompt) throw new Error('Question prompt is required')

    const options = (command.options ?? []).map((option) => {
      const label = option.label.trim()
      if (!label) throw new Error('Question option label is required')
      return {
        id: option.id ?? crypto.randomUUID(),
        label,
      }
    })

    return [
      questionAskedEvent.create({
        questionId: command.questionId ?? crypto.randomUUID(),
        sessionId: command.sessionId,
        messageId: command.messageId,
        prompt,
        options,
        allowFreeform: command.allowFreeform ?? options.length === 0,
      }),
    ]
  })

export default askQuestion
