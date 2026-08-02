import { watch } from 'chokidar'
import { createServer, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createSpecificationRepository,
  SpecEditorRepositoryError,
  type SpecificationRepository,
} from './repository'

export const SPEC_EDITOR_HOST = '127.0.0.1' as const
export const SPEC_EDITOR_PORT = 41739 as const

export type SpecEditorServer = {
  readonly url: string
  close(): Promise<void>
}

export async function startSpecEditor(
  projectRoot: string,
  options: { readonly usePolling?: boolean } = {},
): Promise<SpecEditorServer> {
  const repository = await createSpecificationRepository(projectRoot)
  const clients = new Set<ServerResponse>()
  const server = createServer((request, response) => {
    void handleRequest(repository, clients, request, response)
  })
  await new Promise<void>((accept, reject) => {
    server.once('error', reject)
    server.listen(SPEC_EDITOR_PORT, SPEC_EDITOR_HOST, () => accept())
  })

  const watcher = watch(repository.featuresRoot, {
    ignoreInitial: true,
    persistent: true,
    usePolling: options.usePolling,
  })
  const notify = (absolutePath: string) => {
    const path = relative(repository.featuresRoot, absolutePath)
      .split(sep)
      .join('/')
    if (
      path !== 'spec.json' &&
      path !== 'spec.ts' &&
      !path.endsWith('/spec.json') &&
      !path.endsWith('/spec.ts')
    )
      return
    const message = `data: ${JSON.stringify({ type: 'changed', path })}\n\n`
    for (const client of clients) client.write(message)
  }
  watcher.on('add', notify).on('change', notify).on('unlink', notify)

  await new Promise<void>((accept, reject) => {
    const ready = () => {
      watcher.off('error', failed)
      accept()
    }
    const failed = (cause: unknown) => {
      watcher.off('ready', ready)
      reject(cause)
    }
    watcher.once('ready', ready)
    watcher.once('error', failed)
  }).catch(async (cause) => {
    await watcher.close()
    await new Promise<void>((accept) => server.close(() => accept()))
    throw cause
  })
  watcher.on('error', (cause) => {
    const message = `data: ${JSON.stringify({ type: 'error', message: cause instanceof Error ? cause.message : String(cause) })}\n\n`
    for (const client of clients) client.write(message)
  })

  return {
    url: `http://${SPEC_EDITOR_HOST}:${SPEC_EDITOR_PORT}`,
    close: async () => {
      for (const client of clients) client.end()
      await watcher.close()
      await new Promise<void>((accept, reject) =>
        server.close((cause) => (cause ? reject(cause) : accept())),
      )
    },
  }
}

async function handleRequest(
  repository: SpecificationRepository,
  clients: Set<ServerResponse>,
  request: import('node:http').IncomingMessage,
  response: ServerResponse,
) {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname === '/api/specs' && request.method === 'GET') {
      return json(response, 200, await repository.list())
    }
    if (url.pathname === '/api/specs' && request.method === 'POST') {
      const body = await requestJson(request)
      return json(
        response,
        201,
        await repository.create(readString(body, 'path'), body.document),
      )
    }
    if (url.pathname === '/api/specs' && request.method === 'PUT') {
      const body = await requestJson(request)
      return json(
        response,
        200,
        await repository.save(
          readString(body, 'path'),
          readString(body, 'expectedRevision'),
          body.document,
        ),
      )
    }
    if (url.pathname === '/api/specs' && request.method === 'DELETE') {
      const body = await requestJson(request)
      await repository.remove(
        readString(body, 'path'),
        readString(body, 'expectedRevision'),
      )
      response.writeHead(204).end()
      return
    }
    if (url.pathname === '/api/watch' && request.method === 'GET') {
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      response.write(': connected\n\n')
      clients.add(response)
      request.once('close', () => clients.delete(response))
      return
    }
    if (request.method !== 'GET')
      return json(response, 404, { error: 'Not found.' })
    if (url.pathname === '/')
      return html(response, shell(repository.projectRoot))
    const asset =
      url.pathname === '/client.js'
        ? 'client.js'
        : url.pathname === '/style.css'
          ? 'style.css'
          : undefined
    if (!asset) return json(response, 404, { error: 'Not found.' })
    const source = await readFile(resolve(assetRoot(), asset))
    response.writeHead(200, {
      'content-type': asset.endsWith('.css')
        ? 'text/css; charset=utf-8'
        : 'text/javascript; charset=utf-8',
      'cache-control': 'no-store',
    })
    response.end(source)
  } catch (cause) {
    const status =
      cause instanceof SpecEditorRepositoryError
        ? cause.code === 'NOT_FOUND'
          ? 404
          : cause.code === 'ALREADY_EXISTS' ||
              cause.code === 'REVISION_CONFLICT'
            ? 409
            : cause.code === 'READ_ONLY'
              ? 403
              : 400
        : 500
    json(response, status, {
      error: cause instanceof Error ? cause.message : String(cause),
      ...(cause instanceof SpecEditorRepositoryError
        ? { code: cause.code }
        : {}),
    })
  }
}

async function requestJson(request: import('node:http').IncomingMessage) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > 2_000_000) throw new Error('Request body is too large.')
    chunks.push(buffer)
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Request body must be an object.')
  return parsed as Record<string, unknown>
}

function readString(input: Record<string, unknown>, key: string) {
  const value = input[key]
  if (typeof value !== 'string' || !value)
    throw new Error(`${key} must be a nonempty string.`)
  return value
}

function json(response: ServerResponse, status: number, body: unknown) {
  if (response.headersSent) return
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(body))
}

function html(response: ServerResponse, source: string) {
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(source)
}

function shell(projectRoot: string) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="specter-project-root" content="${escapeHtml(projectRoot)}"><title>Specter Spec Editor</title>
<link rel="stylesheet" href="/style.css"><script type="module" src="/client.js"></script></head>
<body><div id="app"></div></body></html>`
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function assetRoot() {
  return dirname(fileURLToPath(import.meta.url))
}
