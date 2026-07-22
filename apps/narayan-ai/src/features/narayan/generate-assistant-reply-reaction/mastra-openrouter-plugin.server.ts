import type { ReactionPlugin } from '@specter-ts/core'
import type { CoreMessageV4 } from '@mastra/core/agent/message-list'
import { Effect } from 'effect'

import type { GenerateAssistantReplyEffect } from './impl'

const fallbackPrefix = 'Namaste from Narayan AI.'

export const mastraOpenRouterPlugin: ReactionPlugin<{
  type: 'generateAssistantReply'
  payload: GenerateAssistantReplyEffect
}> = (command) =>
  Effect.succeed((output, context) =>
    Effect.gen(function* () {
      const effect = output.payload
      const body = yield* Effect.tryPromise(() => generateReply(effect))

      yield* command(
        {
          type: 'recordAssistantReply',
          payload: {
            inboundMessageId: effect.inboundMessageId,
            outboundMessageId: context.deliveryId,
            to: effect.from,
            body,
            generatedAt: context.scheduledAt,
          },
        },
        { idempotencyKey: context.deliveryId },
      )
    }),
  )

async function generateReply(effect: GenerateAssistantReplyEffect) {
  if (!process.env.OPENROUTER_API_KEY) {
    return `${fallbackPrefix} I received: "${effect.body}". A local commerce assistant will follow up shortly.`
  }

  try {
    const [{ Agent }, { createOpenRouter }] = await Promise.all([
      import('@mastra/core/agent'),
      import('@openrouter/ai-sdk-provider'),
    ])
    const openrouter = createOpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY,
    })
    const modelName = openRouterModelName(
      process.env.OPENROUTER_MODEL ?? 'openai/gpt-4o-mini',
    )
    const agent = new Agent({
      id: 'narayan-ai',
      name: 'Narayan AI',
      instructions:
        'You are Narayan AI, a concise WhatsApp commerce assistant for Kashi local shops. Help customers with product availability, prices, delivery timing, order details, and polite next steps. Keep replies under 700 characters and do not invent exact prices or inventory.',
      model: openrouter(modelName),
    })
    const recentMessages = effect.recentMessages.length
      ? effect.recentMessages
      : [{ role: 'user' as const, body: effect.body }]
    const messages: CoreMessageV4[] = [
      {
        role: 'user',
        content: `Customer WhatsApp conversation from ${effect.from}. You are Narayan AI, a concise WhatsApp commerce assistant for Kashi local shops. Use the following messages as context before replying. Help with product availability, prices, delivery timing, order details, and polite next steps. Keep replies under 700 characters and do not invent exact prices or inventory.`,
      },
      ...recentMessages.map(
        (item): CoreMessageV4 =>
          item.role === 'assistant'
            ? { role: 'assistant', content: item.body }
            : { role: 'user', content: item.body },
      ),
      {
        role: 'user',
        content: 'Reply to the latest customer message.',
      },
    ]
    const response = await agent.generate(messages)

    return String(response.text || '').trim() || fallbackReply(effect.body)
  } catch (cause) {
    return `${fallbackReply(effect.body)} (${formatError(cause)})`
  }
}

function fallbackReply(body: string) {
  return `${fallbackPrefix} I received: "${body}". A Kashi local commerce assistant will reply with details soon.`
}

function openRouterModelName(model: string) {
  return model.startsWith('openrouter/')
    ? model.slice('openrouter/'.length)
    : model
}

function formatError(cause: unknown) {
  if (cause instanceof Error) return `AI fallback used: ${cause.message}`
  return 'AI fallback used'
}
