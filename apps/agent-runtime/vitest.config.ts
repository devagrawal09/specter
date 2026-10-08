import { defineConfig } from 'vitest/config'

// @ocpp/schema is a linked package whose own node_modules carries OC++'s
// effect; dedupe keeps one effect in the process: the app's.
export default defineConfig({
  resolve: { dedupe: ['effect'] },
})
