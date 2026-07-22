import {
  createSpecterApp,
  type CommandExecutionOptions,
  type SpecterCommandEnvelope,
} from '@specter-ts/core'

import {
  narayanDependenciesLayer,
  narayanReactionTickets,
  prepareNarayanAiDb,
  runAfterNarayanReady,
} from '../../db/client.server'
import { createSpecterHttpHandler } from '../../transport/specter-http.server'
import { narayanSpecterAppConfig } from './registry'

await prepareNarayanAiDb()
const app = await createSpecterApp(
  narayanSpecterAppConfig,
  narayanDependenciesLayer(),
)

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
  return runAfterNarayanReady(() =>
    runSpecterCommand(
      { type: 'recordTwilioMessageSent', payload: data },
      { idempotencyKey },
    ),
  )
}

export const handleNarayanSpecterRequest = createSpecterHttpHandler({
  app,
  basePath: '/api/specter',
  run: runAfterNarayanReady,
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
  return runAfterNarayanReady(() =>
    runSpecterCommand({ type: 'recordIncomingTwilioMessage', payload: data }),
  )
}

export async function listNarayanConversationsOnServer() {
  return runAfterNarayanReady(() =>
    app.query({ type: 'conversationsQuery', payload: {} }),
  )
}

export async function listNarayanConversationMessagesOnServer(data: {
  phoneNumber: string
}) {
  return runAfterNarayanReady(() =>
    app.query({ type: 'conversationMessagesQuery', payload: data }),
  )
}

export async function getNarayanHomeDataOnServer() {
  return runAfterNarayanReady(async () => {
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
  return runAfterNarayanReady(async () => {
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
