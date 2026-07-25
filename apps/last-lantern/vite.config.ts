import build from '@hono/vite-build/node'
import devServer from '@hono/vite-dev-server'
import nodeAdapter from '@hono/vite-dev-server/node'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import solidPlugin from 'vite-plugin-solid'
import {
  lastLanternHost,
  lastLanternPort,
  lastLanternViteServer,
} from './src/port'

export default defineConfig(({ mode }) => ({
  resolve: {
    tsconfigPaths: true,
    // Solid beta 13 accepts beta 14 through a caret range, but the two signal runtimes
    // are not binary-compatible. Keep this campaign's browser bundle on one exact beta.
    alias: {
      '@solidjs/signals': fileURLToPath(
        new URL('./node_modules/@solidjs/signals', import.meta.url),
      ),
    },
  },
  server: lastLanternViteServer,
  preview: lastLanternViteServer,
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/tests/e2e/**'],
  },
  build:
    mode === 'client'
      ? {
          rollupOptions: {
            input: './src/client.tsx',
            output: {
              dir: './dist/static',
              entryFileNames: 'client.js',
              chunkFileNames: 'assets/[name]-[hash].js',
              assetFileNames: 'assets/[name][extname]',
            },
          },
          copyPublicDir: true,
          emptyOutDir: true,
        }
      : undefined,
  plugins:
    mode === 'client'
      ? [solidPlugin({ solid: { delegateEvents: false } }), solidWebCompat()]
      : [
          solidPlugin({ solid: { delegateEvents: false } }),
          solidWebCompat(),
          devServer({ entry: './src/server.ts', adapter: nodeAdapter }),
          build({
            entry: './src/server.ts',
            port: lastLanternPort,
            external: ['@libsql/client'],
            entryContentAfterHooks: [
              (appName) => `
import { serve } from '@hono/node-server'
const lastLanternPort = Number(process.env.LAST_LANTERN_PORT ?? ${lastLanternPort})
if (!Number.isSafeInteger(lastLanternPort) || lastLanternPort < 1 || lastLanternPort > 65535) {
  throw new Error('LAST_LANTERN_PORT must be an integer between 1 and 65535.')
}
const server = serve(
  { fetch: ${appName}.fetch, port: lastLanternPort, hostname: '${lastLanternHost}' },
  () => console.log('LAST_LANTERN_LISTENING ${lastLanternHost}:' + lastLanternPort),
)
const closeLastLantern = globalThis[Symbol.for('last-lantern.shutdown')]
let closing = false
const shutdown = async () => {
  if (closing) return
  closing = true
  const serverClosed = new Promise((resolve) => server.close(resolve))
  await Promise.all([serverClosed, closeLastLantern()])
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
`,
            ],
          }),
        ],
}))

function solidWebCompat(): Plugin {
  return {
    name: 'solid-web-add-event-compat',
    enforce: 'post',
    transform(code) {
      if (!code.includes('addEvent') || !code.includes('@solidjs/web')) return
      return code.replace(
        /import\s*\{\s*addEvent\s+as\s+([^\s}]+)\s*\}\s*from\s*(['"])@solidjs\/web\2/g,
        'import { addEventListener as $1 } from $2@solidjs/web$2',
      )
    },
  }
}
