import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/solid-start/server'

import { createSpecterCodeApiRouter } from './features/specter-code/api-routes'

const startHandler = createStartHandler(defaultStreamHandler)
const apiRouter = createSpecterCodeApiRouter()

const EXACT_OPENCODE_API_PATHS = new Set([
  '/agent',
  '/provider/auth',
  '/api/model',
  '/api/provider',
  '/api/session',
  '/config',
  '/config/providers',
  '/command',
  '/event',
  '/experimental/console',
  '/experimental/console/orgs',
  '/experimental/console/switch',
  '/experimental/resource',
  '/experimental/session',
  '/experimental/tool',
  '/experimental/tool/ids',
  '/experimental/workspace',
  '/experimental/workspace/adapter',
  '/experimental/workspace/status',
  '/experimental/workspace/sync-list',
  '/experimental/workspace/warp',
  '/experimental/worktree',
  '/experimental/worktree/reset',
  '/formatter',
  '/global/config',
  '/global/event',
  '/global/health',
  '/global/dispose',
  '/global/upgrade',
  '/instance/dispose',
  '/log',
  '/sync/history',
  '/sync/replay',
  '/sync/start',
  '/sync/steal',
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
  '/project/git/init',
  '/provider',
  '/pty',
  '/pty/shells',
  '/question',
  '/session',
  '/session/status',
  '/skill',
  '/tui/append-prompt',
  '/tui/clear-prompt',
  '/tui/control/next',
  '/tui/control/response',
  '/tui/execute-command',
  '/tui/open-help',
  '/tui/open-models',
  '/tui/open-sessions',
  '/tui/open-themes',
  '/tui/publish',
  '/tui/select-session',
  '/tui/show-toast',
  '/tui/submit-prompt',
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
    /^\/auth\/[^/]+$/.test(normalized) ||
    /^\/provider\/[^/]+\/oauth\/(authorize|callback)$/.test(normalized) ||
    /^\/experimental\/workspace\/[^/]+$/.test(normalized) ||
    /^\/experimental\/workspace\/[^/]+\/(status|warp)$/.test(normalized) ||
    /^\/mcp\/[^/]+\/connect$/.test(normalized) ||
    /^\/mcp\/[^/]+\/disconnect$/.test(normalized) ||
    /^\/mcp\/[^/]+\/auth$/.test(normalized) ||
    /^\/mcp\/[^/]+\/auth\/(authenticate|callback)$/.test(normalized) ||
    /^\/permission\/[^/]+\/reply$/.test(normalized) ||
    /^\/project\/[^/]+$/.test(normalized) ||
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
    /^\/session\/[^/]+\/share$/.test(normalized) ||
    /^\/session\/[^/]+\/shell$/.test(normalized) ||
    /^\/session\/[^/]+\/summarize$/.test(normalized) ||
    /^\/session\/[^/]+\/todo$/.test(normalized) ||
    /^\/session\/[^/]+\/unrevert$/.test(normalized)
  )
}

async function fetch(request: Request, options?: unknown) {
  const url = new URL(request.url)
  if (
    (request.method === 'POST' || request.method === 'GET') &&
    url.pathname.startsWith('/api/specter/')
  ) {
    const { handleSpecterCodeSpecterRequest } = await import(
      './features/specter-code/server-runtime.server'
    )
    return handleSpecterCodeSpecterRequest(request)
  }
  if (isOpenCodeApiPath(url.pathname)) {
    return apiRouter.handle(request)
  }

  return (
    startHandler as (
      request: Request,
      options?: unknown,
    ) => Promise<Response> | Response
  )(request, options)
}

export default { fetch }
