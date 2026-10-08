#!/usr/bin/env node
import { resolve } from 'node:path'

import { startSpecEditor } from './server'

const args = process.argv.slice(2)
if (args.length > 1 || args[0] === '--help' || args[0] === '-h') {
  console.log('Usage: specter-spec-editor [project-root]')
  process.exit(args.length > 1 ? 1 : 0)
}

const server = await startSpecEditor(resolve(args[0] ?? '.'))
console.log(`Specter Spec Editor: ${server.url}`)

let closing = false
async function close() {
  if (closing) return
  closing = true
  await server.close()
}
process.once('SIGINT', () => void close().then(() => process.exit(0)))
process.once('SIGTERM', () => void close().then(() => process.exit(0)))
