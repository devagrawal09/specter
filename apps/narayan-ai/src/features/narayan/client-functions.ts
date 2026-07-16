import { specterClient } from '../../specter-client'

export async function getNarayanHomeData() {
  const conversations = await specterClient.conversationsQuery({})
  const first = conversations[0]
  const messages = first
    ? await specterClient.conversationMessagesQuery({
        phoneNumber: first.phoneNumber,
      })
    : []

  return { conversations, messages }
}

export async function listNarayanConversationMessages(input: {
  data: { phoneNumber: string }
}) {
  return specterClient.conversationMessagesQuery(input.data)
}

export async function createNarayanTestInboundMessage(input: {
  data: { from: string; body: string }
}) {
  await specterClient.recordIncomingTwilioMessage({
    inboundMessageId: crypto.randomUUID(),
    twilioMessageSid: `local-${crypto.randomUUID()}`,
    from: input.data.from,
    to: 'whatsapp:+14155238886',
    body: input.data.body,
    receivedAt: new Date().toISOString(),
  })

  return specterClient.conversationMessagesQuery({
    phoneNumber: input.data.from,
  })
}
