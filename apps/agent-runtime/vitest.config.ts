import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// @ocpp/schema is built against effect 4.0.0-rc.112; Specter is on 4.0.1.
// Mixing the two makes every payload decode throw ("s.startsWith is not a
// function"), so tests resolve one effect: the one @ocpp/schema was built
// with. Remove when OC++ and Specter share an effect version.
const oppEffect = fileURLToPath(
  new URL(
    '../../../opencode/node_modules/.bun/effect@4.0.0-rc.112/node_modules/effect',
    import.meta.url,
  ),
)

// M2 prerequisite to remove: align the effect version with OC++.
export default defineConfig({
  resolve: {
    alias: [{ find: /^effect(\/.*)?$/, replacement: `${oppEffect}$1` }],
  },
})
