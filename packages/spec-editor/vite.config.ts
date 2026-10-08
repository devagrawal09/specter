import { defineConfig } from 'vite'
import solidPlugin from 'vite-plugin-solid'

export default defineConfig({
  plugins: [solidPlugin()],
  resolve: { tsconfigPaths: true },
  build: {
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: {
        index: './src/index.ts',
        cli: './src/cli.ts',
        client: './src/client.tsx',
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: [
        /^@specter-ts\/spec(?:\/.*)?$/,
        /^node:/,
        'chokidar',
        /^(?:events|fs|fs\/promises|os|path)$/,
      ],
      output: { assetFileNames: 'style[extname]' },
    },
  },
})
