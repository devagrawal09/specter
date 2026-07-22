import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url))
const api = pathToFileURL(
  fileURLToPath(new URL('../dist/index.js', import.meta.url)),
).href
const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true })
})

describe('specter-spec export', () => {
  it.each([
    ['explicit file', (root: string) => join(root, 'one', 'spec.ts')],
    ['directory', (root: string) => root],
    ['glob', (root: string) => `${root}/**/spec.ts`],
  ])('discovers an %s and writes deterministic adjacent JSON', (_, input) => {
    const root = fixtureRoot()
    writeSpecification(join(root, 'one', 'spec.ts'), 'one')

    const first = run(input(root))
    expect(first.status, first.stderr).toBe(0)
    const output = readFileSync(join(root, 'one', 'spec.json'), 'utf8')
    expect(JSON.parse(output)).toMatchObject({ kind: 'command', name: 'one' })
    expect(run(input(root)).status).toBe(0)
    expect(readFileSync(join(root, 'one', 'spec.json'), 'utf8')).toBe(output)
  })

  it('requires a default export and reports the isolated child failure', () => {
    const root = fixtureRoot()
    const file = join(root, 'missing-spec.ts')
    write(file, `export const value = true\n`)

    const result = run(file)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(
      'must default-export exactly one Slice specification',
    )
    expect(result.stderr).toContain('Failed to export ')
    expect(result.stderr).toContain('missing-spec.ts')
  })

  it('executes every specification in a fresh subprocess', () => {
    const root = fixtureRoot()
    writeSpecification(join(root, 'one', 'spec.ts'), 'one', true)
    writeSpecification(join(root, 'two', 'spec.ts'), 'two', true)

    const result = run(root)
    expect(result.status, result.stderr).toBe(0)
    expect(
      JSON.parse(readFileSync(join(root, 'one', 'spec.json'), 'utf8')).name,
    ).toBe('one')
    expect(
      JSON.parse(readFileSync(join(root, 'two', 'spec.json'), 'utf8')).name,
    ).toBe('two')
  })
})

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'specter-spec-cli-'))
  directories.push(root)
  return root
}

function writeSpecification(
  file: string,
  name: string,
  assertIsolated = false,
) {
  write(
    file,
    `import { createCommandSlice, event } from '${api}'
${
  assertIsolated
    ? `if ((globalThis as Record<string, unknown>).__specterSpecLoaded) throw new Error('shared process')
(globalThis as Record<string, unknown>).__specterSpecLoaded = true
`
    : ''
}const specification = createCommandSlice('${name}').description('${name}.').scenarios({ description: '${name}.', given: [], when: {}, expect: [event('${name}-recorded', {})] })
export default specification
`,
  )
}

function write(file: string, content: string) {
  mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true })
  writeFileSync(file, content)
}

function run(input: string) {
  return spawnSync(process.execPath, [cli, 'export', input], {
    encoding: 'utf8',
  })
}
