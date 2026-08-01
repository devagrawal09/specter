import { existsSync, readdirSync, realpathSync } from 'node:fs'
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

function filesBelow(directory) {
  if (!existsSync(directory)) {
    return []
  }

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = resolve(directory, entry.name)

    return entry.isDirectory() ? filesBelow(entryPath) : [entryPath]
  })
}

for (const root of openspecRoots) {
  const configPath = resolve(root, 'openspec/config.yaml')
  const schemaPath = resolve(root, 'openspec/schemas/ongoing-change/schema.yaml')

  if (!existsSync(configPath)) {
    console.error(`Missing OpenSpec root: ${configPath}`)
    failed = true
    continue
  }

  if (!existsSync(schemaPath)) {
    console.error(`Missing ongoing-change schema: ${schemaPath}`)
    failed = true
    continue
  }

  const sharedSchemaPath = resolve(
    repositoryRoot,
    'openspec/schemas/ongoing-change/schema.yaml',
  )

  if (realpathSync(schemaPath) !== realpathSync(sharedSchemaPath)) {
    console.error(`OpenSpec root does not use the shared schema: ${schemaPath}`)
    failed = true
    continue
  }

  const relativeRoot =
    root === repositoryRoot ? '.' : root.slice(repositoryRoot.length + 1)

  console.log(`Validating OpenSpec root: ${relativeRoot}`)

  const result = spawnSync(
    'openspec',
    ['schema', 'validate', 'ongoing-change'],
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

  const permanentFiles = filesBelow(resolve(root, 'openspec/specs'))

  if (permanentFiles.length > 0) {
    console.error(
      `Permanent OpenSpec files are not allowed in ${relativeRoot}: ${permanentFiles.join(', ')}`,
    )
    failed = true
  }

  const changesPath = resolve(root, 'openspec/changes')
  const changeNames = existsSync(changesPath)
    ? readdirSync(changesPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name !== 'archive')
        .map((entry) => entry.name)
    : []

  const archivedFiles = filesBelow(resolve(changesPath, 'archive'))

  if (archivedFiles.length > 0) {
    console.error(
      `Archived OpenSpec changes are not allowed in ${relativeRoot}: ${archivedFiles.join(', ')}`,
    )
    failed = true
  }

  for (const changeName of changeNames) {
    const changePath = resolve(changesPath, changeName)
    const changeEntries = readdirSync(changePath, { withFileTypes: true })
    const unexpectedEntries = changeEntries
      .map((entry) => entry.name)
      .filter((name) => name !== '.openspec.yaml' && name !== 'spec.md')

    if (
      !existsSync(resolve(changePath, '.openspec.yaml')) ||
      !existsSync(resolve(changePath, 'spec.md')) ||
      unexpectedEntries.length > 0
    ) {
      console.error(
        `Change ${relativeRoot}:${changeName} must contain only .openspec.yaml and spec.md`,
      )
      failed = true
      continue
    }

    const status = spawnSync(
      'openspec',
      ['status', '--change', changeName, '--json'],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, OPENSPEC_TELEMETRY: '0' },
      },
    )

    if (status.error || status.status !== 0) {
      console.error(
        `Could not read OpenSpec change ${relativeRoot}:${changeName}: ${status.error?.message ?? status.stderr}`,
      )
      failed = true
      continue
    }

    const changeStatus = JSON.parse(status.stdout)
    const artifactIds = Object.keys(changeStatus.artifactPaths)

    if (
      changeStatus.schemaName !== 'ongoing-change' ||
      !changeStatus.isComplete ||
      artifactIds.length !== 1 ||
      artifactIds[0] !== 'spec'
    ) {
      console.error(
        `Change ${relativeRoot}:${changeName} does not follow the one-file ongoing-change schema`,
      )
      failed = true
    }
  }
}

if (failed) {
  process.exitCode = 1
}
