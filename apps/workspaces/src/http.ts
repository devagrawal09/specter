import { once } from 'node:events'
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { readFile } from 'node:fs/promises'
import { SpecterError, type SpecterCommandEnvelope } from '@specter-ts/core'
import { z } from 'zod'
import type { config, WorkspaceApp } from './app'

const envelope = z
  .object({
    type: z.enum([
      'saveDocument',
      'postMessage',
      'setTask',
      'setView',
      'appendMessage',
    ]),
    payload: z.unknown(),
  })
  .strict()

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(value))
}

async function body(request: IncomingMessage) {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > 1_048_576) throw new Error('Request too large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

// Local development transport. It owns delivery, never authoritative app state.
export function workspaceServer(app: WorkspaceApp) {
  return createServer((request, response) => {
    void route(request, response).catch(() => {
      if (!response.headersSent)
        json(response, 500, { error: 'Internal failure' })
      else response.destroy()
    })
  })

  async function route(request: IncomingMessage, response: ServerResponse) {
    // Reject cross-origin requests and DNS rebinding; this prototype has no accounts.
    if (!/^127\.0\.0\.1:\d+$/.test(request.headers.host ?? '')) {
      json(response, 403, { error: 'Local host required' })
      return
    }
    if (
      request.headers.origin &&
      request.headers.origin !== `http://${request.headers.host}`
    ) {
      json(response, 403, { error: 'Origin rejected' })
      return
    }
    if (request.method === 'GET' && request.url === '/') {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      })
      response.end(
        await readFile(new URL('../index.html', import.meta.url), 'utf8'),
      )
      return
    }
    if (request.method === 'GET' && request.url === '/api/workspace') {
      json(response, 200, await app.query({ type: 'workspace', payload: {} }))
      return
    }
    if (request.method === 'GET' && request.url === '/api/subscribe') {
      const abort = new AbortController()
      response.once('close', () => abort.abort())
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      })
      try {
        for await (const value of app.subscribe(
          { type: 'workspace', payload: {} },
          { signal: abort.signal },
        )) {
          if (!response.write(`data: ${JSON.stringify(value)}\n\n`))
            await once(response, 'drain', { signal: abort.signal })
        }
      } finally {
        abort.abort()
        response.end()
      }
      return
    }
    if (request.method === 'POST' && request.url === '/api/command') {
      if (request.headers['content-type'] !== 'application/json') {
        json(response, 415, { error: 'JSON required' })
        return
      }
      try {
        // Allowlist the envelope here; each registered slice validates its payload.
        const command = envelope.parse(
          await body(request),
        ) as SpecterCommandEnvelope<typeof config>
        const key = request.headers['idempotency-key']
        if (typeof key !== 'string' || !key.trim() || key.length > 200) {
          json(response, 400, { error: 'Idempotency key required' })
          return
        }
        const execution = await app.command(command, {
          idempotencyKey: key,
          idempotencyMode: 'exact',
        })
        await execution.reactions
        json(response, 200, {
          version: execution.version,
          duplicate: execution.duplicate,
        })
      } catch (error) {
        if (error instanceof SpecterError) {
          const conflict = [
            'SPECTER_COMMAND_REJECTED',
            'SPECTER_IDEMPOTENCY_CONFLICT',
            'SPECTER_VERSION_CONFLICT',
          ].includes(error.code)
          json(
            response,
            conflict ? 409 : error.code === 'SPECTER_INVALID_INPUT' ? 400 : 500,
            {
              error: error.code,
              message: conflict
                ? error.message
                : 'Command failed validation or execution',
            },
          )
        } else if (error instanceof z.ZodError || error instanceof SyntaxError)
          json(response, 400, { error: 'Invalid command' })
        else if (
          error instanceof Error &&
          error.message === 'Request too large'
        )
          json(response, 413, { error: error.message })
        else json(response, 500, { error: 'Internal failure' })
      }
      return
    }
    json(response, 404, { error: 'Not found' })
  }
}
