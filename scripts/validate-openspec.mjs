import { existsSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const repositoryRoot = process.cwd()

const workspaceRoots = ['apps', 'packages'].flatMap((group) => {
  const groupPath = resolve(repositoryRoot, group)

  return readdirSync(groupPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(groupPath, entry.name))
})

const openspecRoots = [repositoryRoot, ...workspaceRoots].sort()
let failed = false

for (const root of openspecRoots) {
  const configPath = resolve(root, 'openspec/config.yaml')

  if (!existsSync(configPath)) {
    console.error(`Missing OpenSpec root: ${configPath}`)
    failed = true
    continue
  }

  const relativeRoot =
    root === repositoryRoot ? '.' : root.slice(repositoryRoot.length + 1)

  console.log(`Validating OpenSpec root: ${relativeRoot}`)

  const result = spawnSync(
    'openspec',
    ['validate', '--all', '--strict', '--no-interactive'],
    {
      cwd: root,
      env: { ...process.env, OPENSPEC_TELEMETRY: '0' },
      stdio: 'inherit',
    },
  )

  if (result.error) {
    console.error(
      `Could not run OpenSpec in ${relativeRoot}: ${result.error.message}`,
    )
    failed = true
    continue
  }

  if (result.status !== 0) {
    failed = true
  }
}

if (failed) {
  process.exitCode = 1
}
