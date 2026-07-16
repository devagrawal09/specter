import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporaryRoot = mkdtempSync(join(tmpdir(), 'specter-starter-'))
const projectName = 'generated-project'
const projectDirectory = join(temporaryRoot, projectName)

try {
  run('pnpm', ['--filter', '@specter-ts/core', 'build'], repositoryRoot)
  run('pnpm', ['--filter', 'create-specter', 'build'], repositoryRoot)
  run(
    process.execPath,
    [
      join(repositoryRoot, 'packages/create-specter/dist/index.js'),
      projectName,
      '--install',
    ],
    temporaryRoot,
    {
      SPECTER_CORE_SPEC: `file:${join(repositoryRoot, 'packages/core')}`,
    },
  )

  for (const script of ['check', 'lint', 'typecheck', 'test', 'build']) {
    run('npm', ['run', script], projectDirectory)
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
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
