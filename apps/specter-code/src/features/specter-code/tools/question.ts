import type { ToolDefinition } from '../adapters/tool-registry'

export type QuestionToolOptionInput = {
  id?: string
  label: string
}

export type QuestionToolOption = {
  id: string
  label: string
}

export type QuestionToolInput = {
  questionId?: string
  prompt: string
  options?: QuestionToolOptionInput[]
  allowFreeform?: boolean
}

export type QuestionToolOutput = {
  questionId: string
  sessionId: string
  messageId: string
  prompt: string
  options: QuestionToolOption[]
  allowFreeform: boolean
  status: 'pending'
}

function normalizePrompt(prompt: string) {
  const normalized = prompt.trim()
  if (!normalized) throw new Error('Question prompt is required')
  return normalized
}

function normalizeOption(option: QuestionToolOptionInput): QuestionToolOption {
  const label = option.label.trim()
  if (!label) throw new Error('Question option label is required')
  return {
    id: option.id ?? crypto.randomUUID(),
    label,
  }
}

export const questionTool: ToolDefinition<QuestionToolInput, QuestionToolOutput> = {
  name: 'question',
  description: 'Ask the user a clarifying question and wait for an answer',
  permission: 'question.ask',
  async execute(input, context) {
    const prompt = normalizePrompt(input.prompt)
    const options = (input.options ?? []).map(normalizeOption)
    const output: QuestionToolOutput = {
      questionId: input.questionId ?? crypto.randomUUID(),
      sessionId: context.sessionId,
      messageId: context.messageId,
      prompt,
      options,
      allowFreeform: input.allowFreeform ?? options.length === 0,
      status: 'pending',
    }

    await context.metadata({
      toolName: 'question',
      status: 'completed',
      summary: 'Asked question: ' + prompt,
    })

    return output
  },
}
