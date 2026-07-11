import twilio from 'twilio'
import { describe, expect, it } from 'vitest'
import { createSpecterApp } from '@specter-ts/core'

import { sqliteScenario } from '../../db/scenario-tests'
import { sqliteEventLog } from '../../db/specter-sqlite'
import { narayanSpecterAppConfig } from './registry'
import { handleTwilioIncomingWebhook } from './twilio-webhook.server'

const scenario = sqliteScenario()

describe('Narayan AI Specter lifecycle', () => {
  it('records an inbound command and returns it from message queries', async () => {
    await scenario(async () => {
      const app = createSpecterApp(narayanSpecterAppConfig)

      await app.recordIncomingTwilioMessage({
        twilioMessageSid: 'SM-inbound-1',
        from: 'whatsapp:+155****0001',
        to: 'whatsapp:+141****8886',
        body: 'Do you have puja flowers?',
        receivedAt: '2026-06-28T10:00:00.000Z',
      })

      const messages = await app.conversationMessagesQuery({
        phoneNumber: 'whatsapp:+155****0001',
      })

      expect(messages.some((message) => message.direction === 'inbound')).toBe(
        true,
      )
      expect(messages[0]).toMatchObject({
        phoneNumber: 'whatsapp:+155****0001',
        body: 'Do you have puja flowers?',
        status: 'received',
      })
    })
  })

  it('emits duplicate ignored events without duplicating inbound message rows', async () => {
    await scenario(async () => {
      const app = createSpecterApp(narayanSpecterAppConfig)
      const command = {
        twilioMessageSid: 'SM-duplicate-1',
        from: 'whatsapp:+155****0002',
        to: 'whatsapp:+141****8886',
        body: 'Namaste',
        receivedAt: '2026-06-28T10:01:00.000Z',
      }

      await app.recordIncomingTwilioMessage(command)
      await app.recordIncomingTwilioMessage(command)

      const messages = await app.conversationMessagesQuery({
        phoneNumber: 'whatsapp:+155****0002',
      })
      const inboundMessages = messages.filter(
        (message) => message.direction === 'inbound',
      )
      const duplicateEvents = await sqliteEventLog.query(0, [
        'twilioInboundDuplicateIgnored',
      ])

      expect(inboundMessages).toHaveLength(1)
      expect(duplicateEvents).toHaveLength(1)
    })
  })

  it('assistant reply command creates an outbound requested message row', async () => {
    await scenario(async () => {
      const app = createSpecterApp(narayanSpecterAppConfig)

      await app.recordAssistantReply({
        inboundMessageId: 'inbound-1',
        to: 'whatsapp:+155****0003',
        body: 'Yes, we can help with that.',
      })

      const messages = await app.conversationMessagesQuery({
        phoneNumber: 'whatsapp:+155****0003',
      })

      expect(messages).toHaveLength(1)
      expect(messages[0]).toMatchObject({
        direction: 'outbound',
        body: 'Yes, we can help with that.',
        status: expect.stringMatching(/requested|failed/),
      })
    })
  })

  it('Twilio webhook dispatches inbound command and returns empty TwiML', async () => {
    await scenario(async () => {
      const previous = process.env.TWILIO_VALIDATE_SIGNATURE
      process.env.TWILIO_VALIDATE_SIGNATURE = 'false'

      try {
        const response = await handleTwilioIncomingWebhook(
          new Request('https://example.test/api/twilio/incoming', {
            method: 'POST',
            headers: {
              'content-type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              MessageSid: 'SM-webhook-1',
              From: 'whatsapp:+155****0004',
              To: 'whatsapp:+141****8886',
              Body: 'Can I order sweets?',
            }),
          }),
        )

        const app = createSpecterApp(narayanSpecterAppConfig)
        const messages = await app.conversationMessagesQuery({
          phoneNumber: 'whatsapp:+155****0004',
        })

        expect(response.status).toBe(200)
        await expect(response.text()).resolves.toBe('<Response/>')
        expect(messages.some((message) => message.body === 'Can I order sweets?')).toBe(
          true,
        )
      } finally {
        if (previous === undefined) {
          delete process.env.TWILIO_VALIDATE_SIGNATURE
        } else {
          process.env.TWILIO_VALIDATE_SIGNATURE = previous
        }
      }
    })
  })

  it('Twilio webhook accepts signed requests when validation is on', async () => {
    await scenario(async () => {
      const authKey = 'TWILIO_' + 'AUTH_TOKEN'
      const previous = {
        TWILIO_VALIDATE_SIGNATURE: process.env.TWILIO_VALIDATE_SIGNATURE,
        auth: process.env[authKey],
        TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
        NARAYAN_AI_PUBLIC_URL: process.env.NARAYAN_AI_PUBLIC_URL,
      }
      const authToken = 'test-token'
      const publicUrl = 'https://public.example/api/twilio/incoming'
      const params = {
        MessageSid: 'SM-webhook-signed-1',
        From: 'whatsapp:+150****0006',
        To: 'whatsapp:+141****8886',
        Body: 'Signed hello',
      }
      process.env.TWILIO_VALIDATE_SIGNATURE = 'true'
      process.env[authKey] = authToken
      delete process.env.TWILIO_ACCOUNT_SID
      process.env.NARAYAN_AI_PUBLIC_URL = 'https://public.example'

      try {
        const response = await handleTwilioIncomingWebhook(
          new Request('http://127.0.0.1:41735/api/twilio/incoming', {
            method: 'POST',
            headers: {
              'content-type': 'application/x-www-form-urlencoded',
              'x-twilio-signature': twilio.getExpectedTwilioSignature(
                authToken,
                publicUrl,
                params,
              ),
            },
            body: new URLSearchParams(params),
          }),
        )

        expect(response.status).toBe(200)
        await expect(response.text()).resolves.toBe('<Response/>')
      } finally {
        if (previous.TWILIO_VALIDATE_SIGNATURE === undefined) {
          delete process.env.TWILIO_VALIDATE_SIGNATURE
        } else {
          process.env.TWILIO_VALIDATE_SIGNATURE = previous.TWILIO_VALIDATE_SIGNATURE
        }
        if (previous.auth === undefined) delete process.env[authKey]
        else process.env[authKey] = previous.auth
        if (previous.TWILIO_ACCOUNT_SID === undefined) {
          delete process.env.TWILIO_ACCOUNT_SID
        } else {
          process.env.TWILIO_ACCOUNT_SID = previous.TWILIO_ACCOUNT_SID
        }
        if (previous.NARAYAN_AI_PUBLIC_URL === undefined) {
          delete process.env.NARAYAN_AI_PUBLIC_URL
        } else {
          process.env.NARAYAN_AI_PUBLIC_URL = previous.NARAYAN_AI_PUBLIC_URL
        }
      }
    })
  })
})
