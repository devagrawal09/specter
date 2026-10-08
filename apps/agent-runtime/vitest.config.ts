import { defineConfig } from 'vitest/config'

// @ocpp/* are linked packages whose own node_modules carry a second copy of
// effect (same version, different module instance). Dedupe keeps one effect
// in the process: the app's. src/single-effect.mjs does the same for the
// tsx child process used by the recovery test.
export default defineConfig({
  resolve: { dedupe: ['effect'] },
})
