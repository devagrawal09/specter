import { createStartHandler, defaultStreamHandler } from '@tanstack/solid-start/server'

import { createSpecterCodeApiRouter } from './features/specter-code/api-routes'

const startHandler = createStartHandler(defaultStreamHandler)
const apiRouter = createSpecterCodeApiRouter()

const EXACT_OPENCODE_API_PATHS = new Set([
  '/agent',
  '/api/model',
  '/api/provider',
  '/api/session',
  '/config',
  '/config/providers',
  '/command',
  '/event',
  '/experimental/tool',
  '/experimental/tool/ids',
  '/formatter',
  '/global/config',
  '/global/event',
  '/global/health',
  '/find',
  '/find/file',
  '/find/symbol',
  '/file',
  '/file/content',
  '/file/status',
  '/lsp',
  '/mcp',
  '/path',
  '/permission',
  '/project',
  '/project/current',
  '/provider',
  '/pty',
  '/pty/shells',
  '/question',
  '/session',
  '/session/status',
  '/skill',
  '/vcs',
  '/vcs/apply',
  '/vcs/diff',
  '/vcs/diff/raw',
  '/vcs/status',
])

function isOpenCodeApiPath(pathname: string) {
  const normalized = pathname.replace(/\/+$/, '') || '/'
  if (EXACT_OPENCODE_API_PATHS.has(normalized)) return true
  return (
    /^\/api\/provider\/[^/]+$/.test(normalized) ||
    /^\/mcp\/[^/]+\/connect$/.test(normalized) ||
    /^\/mcp\/[^/]+\/disconnect$/.test(normalized) ||
    /^\/permission\/[^/]+\/reply$/.test(normalized) ||
    /^\/pty\/[^/]+$/.test(normalized) ||
    /^\/pty\/[^/]+\/connect-token$/.test(normalized) ||
    /^\/pty\/[^/]+\/connect$/.test(normalized) ||
    /^\/question\/[^/]+\/reply$/.test(normalized) ||
    /^\/question\/[^/]+\/reject$/.test(normalized) ||
    /^\/api\/session\/[^/]+\/compact$/.test(normalized) ||
    /^\/api\/session\/[^/]+\/context$/.test(normalized) ||
    /^\/api\/session\/[^/]+\/message$/.test(normalized) ||
    /^\/api\/session\/[^/]+\/prompt$/.test(normalized) ||
    /^\/api\/session\/[^/]+\/wait$/.test(normalized) ||
    /^\/session\/[^/]+$/.test(normalized) ||
    /^\/session\/[^/]+\/abort$/.test(normalized) ||
    /^\/session\/[^/]+\/children$/.test(normalized) ||
    /^\/session\/[^/]+\/command$/.test(normalized) ||
    /^\/session\/[^/]+\/diff$/.test(normalized) ||
    /^\/session\/[^/]+\/fork$/.test(normalized) ||
    /^\/session\/[^/]+\/init$/.test(normalized) ||
    /^\/session\/[^/]+\/message$/.test(normalized) ||
    /^\/session\/[^/]+\/message\/[^/]+$/.test(normalized) ||
    /^\/session\/[^/]+\/message\/[^/]+\/part\/[^/]+$/.test(normalized) ||
    /^\/session\/[^/]+\/permissions\/[^/]+$/.test(normalized) ||
    /^\/session\/[^/]+\/prompt_async$/.test(normalized) ||
    /^\/session\/[^/]+\/revert$/.test(normalized) ||
    /^\/session\/[^/]+\/shell$/.test(normalized) ||
    /^\/session\/[^/]+\/summarize$/.test(normalized) ||
    /^\/session\/[^/]+\/todo$/.test(normalized)
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
