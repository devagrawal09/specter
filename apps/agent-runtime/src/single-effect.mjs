// Preload for plain-Node child processes (tsx): resolve every `effect` import
// from this app, so the linked @ocpp/schema does not load OC++'s own copy
// (vitest does the same with resolve.dedupe; Node has no such switch, and
// --preserve-symlinks breaks pnpm's layout for tsx itself).
import { register } from 'node:module'

const parent = new URL('./app.ts', import.meta.url).href
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      if (specifier === 'effect' || specifier.startsWith('effect/'))
        return next(specifier, { ...context, parentURL: ${JSON.stringify(parent)} })
      return next(specifier, context)
    }
  `)}`,
)
