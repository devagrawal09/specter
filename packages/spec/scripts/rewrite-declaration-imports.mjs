import { readdir, readFile, writeFile } from 'node:fs/promises'

const output = new URL('../dist/', import.meta.url)

for (const entry of await readdir(output)) {
  if (!entry.endsWith('.d.ts')) continue
  const file = new URL(entry, output)
  const source = await readFile(file, 'utf8')
  const rewritten = source.replaceAll(/(from\s+['"]\.\/[^'"]+)\.ts(['"])/g, '$1.js$2')
  if (rewritten !== source) await writeFile(file, rewritten)
}
