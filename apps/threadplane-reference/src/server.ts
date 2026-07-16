import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/solid-start/server'

const startHandler = createStartHandler(defaultStreamHandler)

async function fetch(request: Request, options?: unknown) {
  const url = new URL(request.url)

  if (request.method === 'POST' && url.pathname.startsWith('/api/specter/')) {
    return handleSpecterRequest(request, url.pathname.slice(13))
  }

  return (
    startHandler as (
      request: Request,
      options?: unknown,
    ) => Promise<Response> | Response
  )(request, options)
}

async function handleSpecterRequest(request: Request, method: string) {
  try {
    const { executeThreadplaneSpecterOperationOnServer } = await import(
      './features/threadplane/server-runtime.server'
    )
    const input = await request.json().catch(() => ({}))
    const result = await executeThreadplaneSpecterOperationOnServer(
      method,
      input,
    )
    return Response.json(result ?? null)
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause)
    return Response.json({ error }, { status: 400 })
  }
}

export default { fetch }
