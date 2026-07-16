import type { ReactionPlugin } from '@specter-ts/core'

import type { SendTwilioOutboundEffect } from './impl'

export const twilioOutboundPlugin: ReactionPlugin<{
  type: 'sendTwilioOutbound'
  payload: SendTwilioOutboundEffect
}> = async (command) => {
  return async (output) => {
    const effect = output.payload

    try {
      const accountSid = process.env.TWILIO_ACCOUNT_SID
      const authToken = process.env.TWILIO_AUTH_TOKEN
      const from = process.env.TWILIO_WHATSAPP_FROM

      if (!accountSid || !authToken || !from) {
        await command({
          type: 'recordTwilioMessageFailed',
          payload: {
            outboundMessageId: effect.outboundMessageId,
            error:
              'Missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_WHATSAPP_FROM',
            failedAt: new Date().toISOString(),
          },
        })
        return
      }

      const { default: twilio } = await import('twilio')
      const client = twilio(accountSid, authToken)
      const contentSid = process.env.TWILIO_CONTENT_SID
      const message = await client.messages.create(
        contentSid
          ? {
              from,
              to: effect.to,
              contentSid,
              contentVariables: contentVariablesFor(effect),
            }
          : {
              from,
              to: effect.to,
              body: effect.body,
            },
      )

      await command({
        type: 'recordTwilioMessageSent',
        payload: {
          outboundMessageId: effect.outboundMessageId,
          twilioMessageSid: message.sid,
          status: message.status,
          sentAt: new Date().toISOString(),
        },
      })
    } catch (cause) {
      await command({
        type: 'recordTwilioMessageFailed',
        payload: {
          outboundMessageId: effect.outboundMessageId,
          error: cause instanceof Error ? cause.message : 'Twilio send failed',
          failedAt: new Date().toISOString(),
        },
      })
    }
  }
}

function contentVariablesFor(effect: SendTwilioOutboundEffect) {
  const template = process.env.TWILIO_CONTENT_VARIABLES_JSON
  if (!template) {
    return JSON.stringify({
      '1': effect.body,
      '2': 'Narayan AI',
    })
  }

  return template
    .replaceAll('{{body}}', effect.body)
    .replaceAll('{{to}}', effect.to)
    .replaceAll('{{outboundMessageId}}', effect.outboundMessageId)
}
