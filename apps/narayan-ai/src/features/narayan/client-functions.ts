import { runSpecterCommand, specterTransport } from '../../specter-transport'

export async function getNarayanHomeData() {
  const conversations = await specterTransport.query({
    type: 'conversationsQuery',
    payload: {},
  })
  const first = conversations[0]
  const messages = first
    ? await specterTransport.query({
        type: 'conversationMessagesQuery',
        payload: {
          phoneNumber: first.phoneNumber,
        },
      })
    : []

  return { conversations, messages }
}

export async function listNarayanConversationMessages(input: {
  data: { phoneNumber: string }
}) {
  return specterTransport.query({
    type: 'conversationMessagesQuery',
    payload: input.data,
  })
}

export async function createNarayanTestInboundMessage(input: {
  data: { from: string; body: string }
}) {
  await runSpecterCommand({
    type: 'recordIncomingTwilioMessage',
    payload: {
      inboundMessageId: crypto.randomUUID(),
      twilioMessageSid: `local-${crypto.randomUUID()}`,
      from: input.data.from,
      to: 'whatsapp:+14155238886',
      body: input.data.body,
      receivedAt: new Date().toISOString(),
    },
  })

  return specterTransport.query({
    type: 'conversationMessagesQuery',
    payload: {
      phoneNumber: input.data.from,
    },
  })
}
