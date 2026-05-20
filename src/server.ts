import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { z } from 'zod'

import { db } from './db/client.server'
import { createFileJsonSliceStorage } from './lib/json-storage'
import {
  commandInput,
  dispatchCommandInTx,
  queryProjection,
} from './lib/registry'
import { projectionRegistrations } from './lib/registry'
import './styles.css?url'

const jsonStorage = createFileJsonSliceStorage('./data/slice-state')

const projectionInput = z.object({
  projectionName: z.string(),
  input: z.unknown(),
})

type ApiError = {
  ok: false
  code: 'BAD_REQUEST' | 'NOT_FOUND' | 'INTERNAL_ERROR'
  message: string
}

type SerializableProjectionResult =
  | null
  | string
  | number
  | boolean
  | SerializableProjectionResult[]
  | { [key: string]: SerializableProjectionResult }

const app = new Hono()

const routes = app
  .get('/api/projection', (c) => {
    const rawInput = c.req.query('input')
    const parsedInput = rawInput ? safeJsonParse(rawInput) : {}
    const body = projectionInput.safeParse({
      projectionName: c.req.query('projectionName'),
      input: parsedInput,
    })

    if (!body.success) {
      return c.json(error('BAD_REQUEST', body.error.message), 400)
    }

    const registration = projectionRegistrations.find(
      (projection) => projection.name === body.data.projectionName,
    )

    if (!registration) {
      return c.json(
        error('NOT_FOUND', `Unknown projection: ${body.data.projectionName}`),
        404,
      )
    }

    const input = registration.schema.safeParse(body.data.input)

    if (!input.success) {
      return c.json(error('BAD_REQUEST', input.error.message), 400)
    }

    return c.json({
      ok: true as const,
      data: queryProjection(registration, input.data, {
        tx: db,
        jsonStorage,
      }) as SerializableProjectionResult,
    })
  })
  .post('/api/command', async (c) => {
    const body = commandInput.safeParse(await c.req.json().catch(() => null))

    if (!body.success) {
      return c.json(error('BAD_REQUEST', body.error.message), 400)
    }

    try {
      db.transaction((tx) =>
        dispatchCommandInTx(body.data, { tx, jsonStorage }),
      )
      return c.json({ ok: true as const })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Command failed'
      return c.json(error('INTERNAL_ERROR', message), 500)
    }
  })

app.use('/static/*', serveStatic({ root: './dist' }))
app.get('/manifest.json', serveStatic({ path: './public/manifest.json' }))
app.get('/favicon.ico', serveStatic({ path: './public/favicon.ico' }))

app.get('*', (c) => c.html(renderShell()))

function error(code: ApiError['code'], message: string): ApiError {
  return { ok: false, code, message }
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function renderShell() {
  const clientScript = import.meta.env.PROD
    ? '/static/client.js'
    : '/src/client.tsx'
  const stylesheet = import.meta.env.PROD
    ? '/static/assets/client.css'
    : '/src/styles.css'

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Specter Todos</title>
    <link rel="stylesheet" href="${stylesheet}" />
    <script type="module" src="${clientScript}"></script>
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>`
}

export type AppType = typeof routes
export default app
