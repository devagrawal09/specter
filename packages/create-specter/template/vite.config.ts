import build from '@hono/vite-build/node'
import devServer from '@hono/vite-dev-server'
import nodeAdapter from '@hono/vite-dev-server/node'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'
import solidPlugin from 'vite-plugin-solid'
import { specterRefsPlugin } from '@specter-ts/core/vite'

export default defineConfig(({ mode }) => ({
  resolve: { tsconfigPaths: true },
  server: {
    port: 41731,
    strictPort: true,
  },
  preview: {
    port: 41731,
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
          specterRefsPlugin(),
          tailwindcss(),
          solidPlugin({ solid: { delegateEvents: false } }),
          solidWebCompatPlugin(),
        ]
      : [
          specterRefsPlugin(),
          tailwindcss(),
          solidPlugin({ solid: { delegateEvents: false } }),
          solidWebCompatPlugin(),
          devServer({ entry: './src/server.ts', adapter: nodeAdapter }),
          build({
            entry: './src/server.ts',
            port: 41731,
            external: ['better-sqlite3'],
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
