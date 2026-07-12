import { createSpecterApp } from '@specter-ts/core'

import { runWithNarayanAiDb } from '../../db/client.server'
import { narayanSpecterAppConfig } from './registry'

const app = createSpecterApp(narayanSpecterAppConfig)

export async function recordIncomingTwilioMessageOnServer(data: {
  twilioMessageSid: string
  from: string
  to: string
  body: string
  receivedAt?: string
}) {
  return runWithNarayanAiDb(() => app.recordIncomingTwilioMessage(data))
}

export async function listNarayanConversationsOnServer() {
  return runWithNarayanAiDb(() => app.conversationsQuery({}))
}

export async function listNarayanConversationMessagesOnServer(data: {
  phoneNumber: string
}) {
  return runWithNarayanAiDb(() => app.conversationMessagesQuery(data))
}

export async function getNarayanHomeDataOnServer() {
  return runWithNarayanAiDb(async () => {
    const conversations = await app.conversationsQuery({})
    const first = conversations[0]
    const messages = first
      ? await app.conversationMessagesQuery({ phoneNumber: first.phoneNumber })
      : []

    return { conversations, messages }
  })
}

export async function createNarayanTestInboundMessageOnServer(data: {
  from: string
  body: string
}) {
  return runWithNarayanAiDb(async () => {
    await app.recordIncomingTwilioMessage({
      twilioMessageSid: `local-${crypto.randomUUID()}`,
      from: data.from,
      to: process.env.TWILIO_WHATSAPP_FROM ?? 'whatsapp:+14155238886',
      body: data.body,
      receivedAt: new Date().toISOString(),
    })

    return app.conversationMessagesQuery({ phoneNumber: data.from })
  })
}
