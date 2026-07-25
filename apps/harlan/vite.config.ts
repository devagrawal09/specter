import { defineConfig, type Plugin } from 'vite'
import solidPlugin from 'vite-plugin-solid'

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 41740,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 41740,
    strictPort: true,
  },
  plugins: [
    solidPlugin({ solid: { delegateEvents: false } }),
    solidWebCompatPlugin(),
  ],
})

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
