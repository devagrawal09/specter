import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const pin = JSON.parse(
  readFileSync(join(appRoot, 'scripts/upstream.json'), 'utf8'),
)
const specterOnly = process.argv.includes('--specter-only')
const skipTests = process.argv.includes('--skip-tests')
const keep = process.argv.includes('--keep')
const checkout = mkdtempSync(
  join(tmpdir(), 'specter-js-reactivity-benchmark-'),
)
let failed = false

try {
  run('git', ['clone', '--quiet', '--no-checkout', pin.repository, checkout])
  run('git', ['-C', checkout, 'checkout', '--quiet', pin.commit])
  run('pnpm', ['install', '--frozen-lockfile'], checkout)

  const frameworkPath = join(
    checkout,
    'packages/core/src/frameworks/specterFusedSync.ts',
  )
  writeFileSync(
    frameworkPath,
    [
      'import type { ReactiveFramework } from "../util/reactiveFramework";',
      `import { createSpecterFusedSyncFramework } from ${JSON.stringify(join(appRoot, 'src/index.ts'))};`,
      '',
      'export const specterFusedSyncFramework: ReactiveFramework =',
      '  createSpecterFusedSyncFramework();',
      '',
    ].join('\n'),
  )

  const listPath = join(checkout, 'packages/core/src/frameworksList.ts')
  let listSource = readFileSync(listPath, 'utf8')
  listSource = listSource.replace(
    'import type { FrameworkInfo } from "./util/frameworkTypes";',
    [
      'import type { FrameworkInfo } from "./util/frameworkTypes";',
      'import { specterFusedSyncFramework } from "./frameworks/specterFusedSync";',
    ].join('\n'),
  )

  if (specterOnly) {
    listSource = replaceFrameworkArray(
      listSource,
      'frameworkInfo',
      '  { framework: specterFusedSyncFramework },',
    )
    listSource = replaceFrameworkArray(
      listSource,
      'allFrameworks',
      '  { framework: specterFusedSyncFramework },',
    )
  } else {
    listSource = appendFramework(
      listSource,
      'frameworkInfo',
      '  { framework: specterFusedSyncFramework },',
    )
    listSource = appendFramework(
      listSource,
      'allFrameworks',
      '  { framework: specterFusedSyncFramework },',
    )
  }
  writeFileSync(listPath, listSource)

  if (!skipTests) {
    run(
      'pnpm',
      ['--filter', 'js-reactivity-benchmark', 'test', '--', '--run'],
      checkout,
    )
  }
  run(
    'pnpm',
    ['--filter', 'js-reactivity-benchmark-node', 'build'],
    checkout,
  )
  run('pnpm', ['--filter', 'js-reactivity-benchmark-node', 'run'], checkout)
} catch (error) {
  failed = true
  console.error(`Upstream checkout retained for diagnosis: ${checkout}`)
  throw error
} finally {
  if (!keep && !failed) {
    rmSync(checkout, { recursive: true, force: true })
  } else if (keep) {
    console.error(`Upstream checkout retained: ${checkout}`)
  }
}

function run(command, args, cwd = appRoot) {
  execFileSync(command, args, {
    cwd,
    env: { ...process.env, CI: 'true' },
    stdio: 'inherit',
  })
}

function replaceFrameworkArray(source, name, entry) {
  const pattern = new RegExp(
    `export const ${name}: FrameworkInfo\\[\\] = \\[[\\s\\S]*?\\n\\];`,
  )
  if (!pattern.test(source)) {
    throw new Error(`Could not find upstream ${name} registry`)
  }
  return source.replace(
    pattern,
    `export const ${name}: FrameworkInfo[] = [\n${entry}\n];`,
  )
}

function appendFramework(source, name, entry) {
  const prefix = `export const ${name}: FrameworkInfo[] = [`
  const start = source.indexOf(prefix)
  if (start < 0) throw new Error(`Could not find upstream ${name} registry`)
  const end = source.indexOf('\n];', start)
  if (end < 0) throw new Error(`Could not find end of upstream ${name} registry`)
  return `${source.slice(0, end)}\n${entry}${source.slice(end)}`
}
