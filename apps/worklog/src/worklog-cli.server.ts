import type {
  SpecterCommandEnvelope,
  SpecterQueryEnvelope,
} from '@specter-ts/core'

import type { WorklogAppConfig } from './features/worklog/registry'
import { createSpecterBrowserTransport } from './transport/specter-browser'
import { createWorklogRuntime } from './worklog-runtime.server'

export const defaultWorklogUrl = 'http://localhost:41736/api'

type CliRequest =
  | {
      readonly mode: 'command'
      readonly envelope: SpecterCommandEnvelope<WorklogAppConfig>
      readonly idempotencyKey?: string
      readonly db?: string
      readonly url?: string
    }
  | {
      readonly mode: 'query'
      readonly envelope: SpecterQueryEnvelope<WorklogAppConfig>
      readonly db?: string
      readonly url?: string
    }

type CliDependencies = {
  readonly fetch?: typeof globalThis.fetch
  readonly healthTimeoutMs?: number
}

export async function executeWorklogCli(
  request: CliRequest,
  dependencies: CliDependencies = {},
) {
  if (request.db && request.url)
    throw new Error('--db and --url cannot be used together')

  if (request.db) return executeWithSqlite(request)

  const url = normalizeUrl(
    request.url ?? process.env.WORKLOG_URL ?? defaultWorklogUrl,
  )
  const fetchImplementation = dependencies.fetch ?? globalThis.fetch
  const serverAvailable = await isServerAvailable(
    url,
    fetchImplementation,
    dependencies.healthTimeoutMs ?? 750,
  )

  if (!serverAvailable)
    throw new Error(
      `Worklog server is unavailable at ${url}. Pass --db for explicit offline SQLite access.`,
    )

  return executeWithHttp(request, url, fetchImplementation)
}

async function executeWithHttp(
  request: CliRequest,
  url: string,
  fetchImplementation: typeof globalThis.fetch,
) {
  const app = createSpecterBrowserTransport<WorklogAppConfig>(url, {
    fetch: fetchImplementation,
  })

  if (request.mode === 'command') {
    const execution = await app.command(request.envelope, {
      idempotencyKey: request.idempotencyKey,
    })
    await execution.reactions
    return {
      transport: 'http' as const,
      events: execution.events,
      version: execution.version,
      duplicate: execution.duplicate,
    }
  }

  return {
    transport: 'http' as const,
    result: await app.query(request.envelope),
  }
}

async function executeWithSqlite(request: CliRequest) {
  const runtime = await createWorklogRuntime(request.db)
  try {
    if (request.mode === 'command') {
      const execution = await runtime.app.command(request.envelope, {
        idempotencyKey: request.idempotencyKey,
      })
      await execution.reactions
      return {
        transport: 'sqlite' as const,
        events: execution.events,
        version: execution.version,
        duplicate: execution.duplicate,
      }
    }

    return {
      transport: 'sqlite' as const,
      result: await runtime.app.query(request.envelope),
    }
  } finally {
    runtime.close()
  }
}

async function isServerAvailable(
  baseUrl: string,
  fetchImplementation: typeof globalThis.fetch,
  timeoutMs: number,
) {
  try {
    const response = await fetchImplementation(`${baseUrl}/health`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    return response.ok
  } catch {
    return false
  }
}

function normalizeUrl(value: string) {
  return value.replace(/\/$/, '')
}
