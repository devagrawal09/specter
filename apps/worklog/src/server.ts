import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createSpecterHttpHandler } from './transport/specter-http.server'
import { createWorklogRuntime } from './worklog-runtime.server'
import './styles.css?url'

const runtime = await createWorklogRuntime()
const handleSpecterRequest = createSpecterHttpHandler({
  app: runtime.app,
  basePath: '/api',
})

const app = new Hono()

app.get('/api/health', (c) => c.json({ ok: true }))
app.all('/api/*', (c) => handleSpecterRequest(c.req.raw))

const routes = app

app.use('/static/*', serveStatic({ root: './dist' }))
app.get('/manifest.json', serveStatic({ path: './public/manifest.json' }))
app.get('/favicon.ico', serveStatic({ path: './public/favicon.ico' }))

app.get('*', (c) => c.html(renderShell()))

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
    <meta name="theme-color" content="#14110f" />
    <title>Worklog</title>
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
