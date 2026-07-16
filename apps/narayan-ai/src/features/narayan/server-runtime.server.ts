import {
  createSpecterApp,
  type CommandExecutionOptions,
  type SpecterCommandEnvelope,
} from '@specter-ts/core'

import {
  narayanProductionReactionScheduler,
  narayanReactionTickets,
  prepareNarayanAiDb,
  runWithNarayanAiDb,
} from '../../db/client.server'
import { createSpecterHttpHandler } from '../../transport/specter-http.server'
import { createNarayanSpecterAppConfig } from './registry'

await prepareNarayanAiDb()
const narayanSpecterAppConfig = createNarayanSpecterAppConfig(
  narayanProductionReactionScheduler,
)
const app = await createSpecterApp(narayanSpecterAppConfig)

async function runSpecterCommand(
  envelope: SpecterCommandEnvelope<typeof narayanSpecterAppConfig>,
  options?: CommandExecutionOptions,
) {
  const execution = await app.command(envelope, options)
  await execution.reactions
}

export async function recordTwilioMessageSentOnServer(
  data: {
    outboundMessageId: string
    twilioMessageSid: string
    status?: string
    sentAt: string
  },
  idempotencyKey: string,
) {
  return runWithNarayanAiDb(() =>
    runSpecterCommand(
      { type: 'recordTwilioMessageSent', payload: data },
      { idempotencyKey },
    ),
  )
}

export const handleNarayanSpecterRequest = createSpecterHttpHandler({
  app,
  basePath: '/api/specter',
  run: runWithNarayanAiDb,
  reactionTickets: narayanReactionTickets,
})

export async function recordIncomingTwilioMessageOnServer(data: {
  inboundMessageId: string
  twilioMessageSid: string
  from: string
  to: string
  body: string
  receivedAt: string
}) {
  return runWithNarayanAiDb(() =>
    runSpecterCommand({ type: 'recordIncomingTwilioMessage', payload: data }),
  )
}

export async function listNarayanConversationsOnServer() {
  return runWithNarayanAiDb(() =>
    app.query({ type: 'conversationsQuery', payload: {} }),
  )
}

export async function listNarayanConversationMessagesOnServer(data: {
  phoneNumber: string
}) {
  return runWithNarayanAiDb(() =>
    app.query({ type: 'conversationMessagesQuery', payload: data }),
  )
}

export async function getNarayanHomeDataOnServer() {
  return runWithNarayanAiDb(async () => {
    const conversations = await app.query({
      type: 'conversationsQuery',
      payload: {},
    })
    const first = conversations[0]
    const messages = first
      ? await app.query({
          type: 'conversationMessagesQuery',
          payload: { phoneNumber: first.phoneNumber },
        })
      : []

    return { conversations, messages }
  })
}

export async function createNarayanTestInboundMessageOnServer(data: {
  from: string
  body: string
}) {
  return runWithNarayanAiDb(async () => {
    await runSpecterCommand({
      type: 'recordIncomingTwilioMessage',
      payload: {
        inboundMessageId: crypto.randomUUID(),
        twilioMessageSid: `local-${crypto.randomUUID()}`,
        from: data.from,
        to: process.env.TWILIO_WHATSAPP_FROM ?? 'whatsapp:+14155238886',
        body: data.body,
        receivedAt: new Date().toISOString(),
      },
    })

    return app.query({
      type: 'conversationMessagesQuery',
      payload: { phoneNumber: data.from },
    })
  })
}
