import type { ReactionPlugin } from '@specter-ts/core'

import type { GenerateAssistantReplyEffect } from './slice'

const fallbackPrefix = 'Namaste from Narayan AI.'

export const mastraOpenRouterPlugin: ReactionPlugin = async (command) => {
  return async (payload) => {
    const effect = payload as GenerateAssistantReplyEffect
    const body = await generateReply(effect)

    await command({
      type: 'recordAssistantReply',
      payload: {
        inboundMessageId: effect.inboundMessageId,
        to: effect.from,
        body,
      },
    })
  }
}

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
    const response = await agent.generate([
      {
        role: 'user',
        content: `Customer WhatsApp message from ${effect.from}: ${effect.body}`,
      },
    ])

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
