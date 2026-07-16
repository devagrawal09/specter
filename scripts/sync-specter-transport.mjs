import { cpSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const transportFiles = [
  'specter-browser.ts',
  'specter-http.server.ts',
  'specter-protocol.ts',
  'specter-reaction-tickets-sqlite.server.ts',
]
const targetRoots = [
  'apps/booking-reference/src/transport',
  'apps/narayan-ai/src/transport',
  'apps/reference/src/transport',
  'apps/specter-code/src/transport',
  'apps/threadplane-reference/src/transport',
]
const sourceRoot = resolve(
  repositoryRoot,
  'packages/create-specter/template/src/transport',
)
const checkOnly = process.argv.includes('--check')
const drifted = []

for (const file of transportFiles) {
  const source = resolve(sourceRoot, file)
  const expected = readFileSync(source, 'utf8')

  for (const targetRoot of targetRoots) {
    const target = resolve(repositoryRoot, targetRoot, file)
    if (checkOnly) {
      if (readFileSync(target, 'utf8') !== expected) {
        drifted.push(`${targetRoot}/${file}`)
      }
      continue
    }

    cpSync(source, target)
  }
}

if (drifted.length > 0) {
  throw new Error(
    `Generated project transport copies have drifted:\n${drifted
      .map((path) => `- ${path}`)
      .join('\n')}`,
  )
}
