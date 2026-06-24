import { createStartHandler, defaultStreamHandler } from '@tanstack/solid-start/server'

import { createSpecterCodeApiRouter } from './features/specter-code/api-routes'

const startHandler = createStartHandler(defaultStreamHandler)
const apiRouter = createSpecterCodeApiRouter()

const EXACT_OPENCODE_API_PATHS = new Set([
  '/agent',
  '/config',
  '/event',
  '/file',
  '/file/content',
  '/file/status',
  '/permission',
  '/provider',
  '/session',
])

function isOpenCodeApiPath(pathname: string) {
  const normalized = pathname.replace(/\/+$/, '') || '/'
  if (EXACT_OPENCODE_API_PATHS.has(normalized)) return true
  return (
    /^\/permission\/[^/]+\/reply$/.test(normalized) ||
    /^\/session\/[^/]+\/message$/.test(normalized) ||
    /^\/session\/[^/]+\/prompt_async$/.test(normalized)
  )
}

async function fetch(request: Request, options?: unknown) {
  const url = new URL(request.url)
  if (isOpenCodeApiPath(url.pathname)) {
    return apiRouter.handle(request)
  }

  return (startHandler as (request: Request, options?: unknown) => Promise<Response> | Response)(
    request,
    options,
  )
}

export default { fetch }
