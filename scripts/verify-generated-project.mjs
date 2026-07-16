import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporaryRoot = mkdtempSync(join(tmpdir(), 'specter-starter-'))
const projectName = 'generated-project'
const projectDirectory = join(temporaryRoot, projectName)

try {
  run('pnpm', ['--filter', '@specter-ts/core', 'build'], repositoryRoot)
  run('pnpm', ['--filter', '@specter-ts/memory', 'build'], repositoryRoot)
  run(
    'pnpm',
    ['--filter', '@specter-ts/reaction-outbox', 'build'],
    repositoryRoot,
  )
  run('pnpm', ['--filter', '@specter-ts/sqlite', 'build'], repositoryRoot)
  run('pnpm', ['--filter', 'create-specter', 'build'], repositoryRoot)
  run(
    'pnpm',
    [
      '--filter',
      '@specter-ts/core',
      'pack',
      '--pack-destination',
      temporaryRoot,
    ],
    repositoryRoot,
  )
  run(
    'pnpm',
    [
      '--filter',
      '@specter-ts/memory',
      'pack',
      '--pack-destination',
      temporaryRoot,
    ],
    repositoryRoot,
  )
  run(
    'pnpm',
    [
      '--filter',
      '@specter-ts/reaction-outbox',
      'pack',
      '--pack-destination',
      temporaryRoot,
    ],
    repositoryRoot,
  )
  run(
    'pnpm',
    [
      '--filter',
      '@specter-ts/sqlite',
      'pack',
      '--pack-destination',
      temporaryRoot,
    ],
    repositoryRoot,
  )
  run(
    'pnpm',
    [
      '--filter',
      'create-specter',
      'pack',
      '--pack-destination',
      temporaryRoot,
    ],
    repositoryRoot,
  )

  const coreTarball = findTarball('specter-ts-core-')
  const memoryTarball = findTarball('specter-ts-memory-')
  const reactionOutboxTarball = findTarball('specter-ts-reaction-outbox-')
  const sqliteTarball = findTarball('specter-ts-sqlite-')
  const initializerTarball = findTarball('create-specter-')
  run(
    'npm',
    [
      'exec',
      '--yes',
      `--package=${initializerTarball}`,
      '--',
      'create-specter',
      projectName,
      '--install',
    ],
    temporaryRoot,
    {
      SPECTER_CORE_SPEC: `file:${coreTarball}`,
      SPECTER_MEMORY_SPEC: `file:${memoryTarball}`,
      SPECTER_REACTION_OUTBOX_SPEC: `file:${reactionOutboxTarball}`,
      SPECTER_SQLITE_SPEC: `file:${sqliteTarball}`,
    },
  )
  run(
    'npm',
    [
      'exec',
      '--yes',
      `--package=${initializerTarball}`,
      '--',
      'create-specter',
      'generate',
      'persistent-harness',
    ],
    projectDirectory,
  )

  for (const script of ['check', 'lint', 'typecheck', 'test', 'build']) {
    run('npm', ['run', script], projectDirectory)
  }
  run('npm', ['run', 'test:e2e:preflight'], projectDirectory)
  run('npm', ['exec', '--', 'playwright', 'test'], projectDirectory)
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}

function findTarball(prefix) {
  const file = readdirSync(temporaryRoot).find(
    (candidate) => candidate.startsWith(prefix) && candidate.endsWith('.tgz'),
  )
  if (!file) throw new Error(`Packed tarball not found for ${prefix}`)
  return join(temporaryRoot, file)
}

function run(command, args, cwd, environment = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...environment },
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with status ${result.status ?? 'unknown'}`,
    )
  }
}
