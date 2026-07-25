import build from '@hono/vite-build/node'
import devServer from '@hono/vite-dev-server'
import nodeAdapter from '@hono/vite-dev-server/node'
import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => ({
  server: { host: '127.0.0.1', port: 41738, strictPort: true },
  preview: { host: '127.0.0.1', port: 41738, strictPort: true },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/tests/e2e/**'],
  },
  build:
    mode === 'client'
      ? {
          rollupOptions: {
            input: './src/client.ts',
            output: {
              dir: './dist/static',
              entryFileNames: 'client.js',
              assetFileNames: 'assets/[name][extname]',
            },
          },
          copyPublicDir: false,
          emptyOutDir: true,
        }
      : undefined,
  plugins:
    mode === 'client'
      ? []
      : [
          devServer({ entry: './src/server.ts', adapter: nodeAdapter }),
          build({
            entry: './src/server.ts',
            port: 41738,
            external: ['@libsql/client'],
            entryContentAfterHooks: [
              (appName) => `import { serve } from '@hono/node-server'
serve({ fetch: ${appName}.fetch, port: 41738, hostname: '127.0.0.1' })`,
            ],
          }),
        ],
}))
