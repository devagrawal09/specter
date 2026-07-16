import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/solid-start/server'

import { handleTwilioIncomingWebhook } from './features/narayan/twilio-webhook.server'
import { handleTwilioStatusWebhook } from './features/narayan/twilio-status-webhook.server'

const startHandler = createStartHandler(defaultStreamHandler)

async function fetch(request: Request, options?: unknown) {
  const url = new URL(request.url)

  if (
    (request.method === 'POST' || request.method === 'GET') &&
    url.pathname.startsWith('/api/specter/')
  ) {
    const { handleNarayanSpecterRequest } = await import(
      './features/narayan/server-runtime.server'
    )
    return handleNarayanSpecterRequest(request)
  }

  if (url.pathname === '/api/twilio/incoming') {
    return handleTwilioIncomingWebhook(request)
  }
  if (url.pathname === '/api/twilio/status') {
    return handleTwilioStatusWebhook(request)
  }

  return (
    startHandler as (
      request: Request,
      options?: unknown,
    ) => Promise<Response> | Response
  )(request, options)
}

export default { fetch }
