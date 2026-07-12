import askQuestionSpec from './spec'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { questionAskedEvent } from '../events'

const questionOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
})

const askQuestion = askQuestionSpec
  .inputSchema(
    z.object({
      questionId: z.string(),
      sessionId: z.string(),
      messageId: z.string(),
      prompt: z.string(),
      options: z.array(questionOptionSchema).optional(),
      allowFreeform: z.boolean().optional(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  
  .handle(async (command) => {
    const prompt = command.prompt.trim()
    if (!prompt) throw new Error('Question prompt is required')

    const options = (command.options ?? []).map((option) => {
      const label = option.label.trim()
      if (!label) throw new Error('Question option label is required')
      return {
        id: option.id,
        label,
      }
    })

    return [
      questionAskedEvent.create({
        questionId: command.questionId,
        sessionId: command.sessionId,
        messageId: command.messageId,
        prompt,
        options,
        allowFreeform: command.allowFreeform ?? options.length === 0,
      }),
    ]
  })

export default askQuestion
