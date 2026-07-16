import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/solid-start/server'

const startHandler = createStartHandler(defaultStreamHandler)

async function fetch(request: Request, options?: unknown) {
  const url = new URL(request.url)

  if (
    (request.method === 'POST' || request.method === 'GET') &&
    url.pathname.startsWith('/api/specter/')
  ) {
    const { handleThreadplaneSpecterRequest } = await import(
      './features/threadplane/server-runtime.server'
    )
    return handleThreadplaneSpecterRequest(request)
  }

  return (
    startHandler as (
      request: Request,
      options?: unknown,
    ) => Promise<Response> | Response
  )(request, options)
}

export default { fetch }
