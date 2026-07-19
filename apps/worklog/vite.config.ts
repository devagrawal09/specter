import build from '@hono/vite-build/node'
import devServer from '@hono/vite-dev-server'
import nodeAdapter from '@hono/vite-dev-server/node'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'
import solidPlugin from 'vite-plugin-solid'

export default defineConfig(({ mode }) => ({
  resolve: { tsconfigPaths: true },
  server: {
    port: 41736,
    strictPort: true,
  },
  preview: {
    port: 41736,
    strictPort: true,
  },
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
      '**/.reference/**',
      '**/tests/**',
      '**/e2e/**',
      '**/*.e2e.[cm]?[jt]s?(x)',
    ],
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
          copyPublicDir: false,
          emptyOutDir: true,
        }
      : undefined,
  plugins:
    mode === 'client'
      ? [
          tailwindcss(),
          solidPlugin({ solid: { delegateEvents: false } }),
          solidWebCompatPlugin(),
        ]
      : [
          tailwindcss(),
          solidPlugin({ solid: { delegateEvents: false } }),
          solidWebCompatPlugin(),
          devServer({ entry: './src/server.ts', adapter: nodeAdapter }),
          build({
            entry: './src/server.ts',
            port: 41736,
            external: ['@libsql/client'],
            entryContentAfterHooks: [
              (appName) => `
import { serve } from '@hono/node-server'
const server = serve(
  { fetch: ${appName}.fetch, port: 41736, hostname: '127.0.0.1' },
  () => console.log('WORKLOG_LISTENING 127.0.0.1:41736'),
)
const shutdownWorklogApp = globalThis[Symbol.for('worklog.shutdown')]
if (typeof shutdownWorklogApp !== 'function') {
  throw new Error('Worklog runtime did not register a shutdown hook.')
}
let shuttingDown = false
const shutdown = async () => {
  if (shuttingDown) return
  shuttingDown = true
  console.log('WORKLOG_SHUTDOWN_DRAINING')

  const serverClosed = new Promise((resolve) => server.close(resolve))
  try {
    await Promise.race([
      shutdownWorklogApp(serverClosed),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('Worklog shutdown exceeded 5 seconds.')),
          5_000,
        ),
      ),
    ])
    process.exit(0)
  } catch (cause) {
    console.error(cause)
    server.closeAllConnections()
    process.exit(1)
  }
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
`,
            ],
          }),
        ],
}))

function solidWebCompatPlugin(): Plugin {
  return {
    name: 'solid-web-add-event-compat',
    enforce: 'post',
    transform(code) {
      if (!code.includes('addEvent') || !code.includes('@solidjs/web')) {
        return
      }

      return code.replace(
        /import\s*\{\s*addEvent\s+as\s+([^\s}]+)\s*\}\s*from\s*(['"])@solidjs\/web\2/g,
        'import { addEventListener as $1 } from $2@solidjs/web$2',
      )
    },
  }
}
