import { createTwilioDeliveryAttemptStore } from '../../db/twilio-delivery-attempts'
import { db, runAfterNarayanReady } from '../../db/client.server'
import { validateTwilioSignature } from './twilio-webhook.server'

export async function handleTwilioStatusWebhook(request: Request) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }
  const form = await request.formData()
  if (process.env.TWILIO_AUTH_TOKEN) {
    const valid = await validateTwilioSignature(request, form)
    if (!valid) return new Response('Invalid Twilio signature', { status: 403 })
  }

  const messageSid = value(form, 'MessageSid')
  const status = value(form, 'MessageStatus')
  if (!messageSid || !status) {
    return new Response('Missing Twilio status fields', { status: 400 })
  }

  const attempt = await runAfterNarayanReady(() =>
    createTwilioDeliveryAttemptStore(db).findByProviderSid(messageSid),
  )
  if (!attempt) return new Response('Unknown Twilio message', { status: 404 })

  const { recordTwilioMessageSentOnServer } = await import(
    './server-runtime.server'
  )
  await recordTwilioMessageSentOnServer(
    {
      outboundMessageId: attempt.outboundMessageId,
      twilioMessageSid: messageSid,
      status,
      sentAt: new Date().toISOString(),
    },
    `twilio-status:${messageSid}:${status}`,
  )
  return new Response(null, { status: 204 })
}

function value(form: FormData, key: string) {
  const field = form.get(key)
  return typeof field === 'string' && field.trim() ? field.trim() : undefined
}
