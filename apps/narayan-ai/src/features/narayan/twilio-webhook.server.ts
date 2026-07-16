export async function handleTwilioIncomingWebhook(request: Request) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const form = await request.formData()
  const twilioMessageSid = value(form, 'MessageSid')
  const from = value(form, 'From')
  const to = value(form, 'To')
  const body = value(form, 'Body')

  if (!twilioMessageSid || !from || !to) {
    return new Response('Missing Twilio message fields', { status: 400 })
  }

  if (process.env.TWILIO_VALIDATE_SIGNATURE !== 'false') {
    const valid = await validateTwilioSignature(request, form)
    if (!valid) return new Response('Invalid Twilio signature', { status: 403 })
  }

  const { recordIncomingTwilioMessageOnServer } = await import(
    './server-runtime.server'
  )
  await recordIncomingTwilioMessageOnServer({
    inboundMessageId: crypto.randomUUID(),
    twilioMessageSid,
    from,
    to,
    body,
    receivedAt: new Date().toISOString(),
  })

  return new Response('<Response/>', {
    status: 200,
    headers: { 'content-type': 'text/xml; charset=utf-8' },
  })
}

function value(form: FormData, key: string) {
  const item = form.get(key)
  return typeof item === 'string' ? item : ''
}

async function validateTwilioSignature(request: Request, form: FormData) {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const signature = request.headers.get('x-twilio-signature') ?? ''
  if (!authToken || !signature) return false

  const twilio = (await import('twilio')).default
  const params: Record<string, string> = {}
  for (const [key, item] of form.entries()) {
    if (typeof item === 'string') params[key] = item
  }

  return twilio.validateRequest(
    authToken,
    signature,
    publicValidationUrl(request),
    params,
  )
}

function publicValidationUrl(request: Request) {
  const configuredPublicUrl = process.env.NARAYAN_AI_PUBLIC_URL
  if (!configuredPublicUrl) return request.url

  const requestUrl = new URL(request.url)
  const publicUrl = new URL(configuredPublicUrl)
  publicUrl.pathname = requestUrl.pathname
  publicUrl.search = requestUrl.search
  return publicUrl.toString()
}
