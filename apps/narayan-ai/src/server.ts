import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/solid-start/server'

import { handleTwilioIncomingWebhook } from './features/narayan/twilio-webhook.server'

const startHandler = createStartHandler(defaultStreamHandler)

async function fetch(request: Request, options?: unknown) {
  const url = new URL(request.url)

  if (url.pathname === '/api/twilio/incoming') {
    return handleTwilioIncomingWebhook(request)
  }

  return (
    startHandler as (
      request: Request,
      options?: unknown,
    ) => Promise<Response> | Response
  )(request, options)
}

export default { fetch }
