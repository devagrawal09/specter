#!/usr/bin/env node
import { Args, Command, Options } from '@effect/cli'
import { NodeContext, NodeRuntime } from '@effect/platform-node'
import { Console, Effect } from 'effect'
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type TemplatePackageJson = {
  name?: string
  dependencies?: Record<string, string>
}

type PackageJson = {
  version?: string
}

const projectDirectory = Args.text({ name: 'project-directory' }).pipe(
  Args.withDescription('Directory to create the Specter project in'),
  Args.withDefault('my-specter-app'),
)

const force = Options.boolean('force').pipe(
  Options.withDescription('Overwrite the target directory if it exists'),
)

const install = Options.boolean('install').pipe(
  Options.withDescription('Run npm install after creating the project'),
)

const command = Command.make(
  'create-specter',
  { projectDirectory, force, install },
  ({ projectDirectory, force, install }) =>
    Effect.gen(function* () {
      const cwd = process.cwd()
      const targetDirectory = resolve(cwd, projectDirectory)
      const projectName = packageNameFromDirectory(targetDirectory)

      yield* Effect.try({
        try: () => prepareTargetDirectory(targetDirectory, force),
        catch: (cause) => new Error(String(cause)),
      })

      yield* Effect.try({
        try: () => copyTemplate(targetDirectory, projectName),
        catch: (cause) => new Error(String(cause)),
      })

      if (install) {
        yield* runNpmInstall(targetDirectory)
      }

      yield* Console.log(successMessage(projectDirectory, install))
    }),
).pipe(
  Command.withDescription(
    'Create a new Specter project from the todo reference app starter.',
  ),
)

const cli = Command.run(command, {
  name: 'Create Specter',
  version: packageVersion(),
})

cli(normalizeArgs(process.argv)).pipe(
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain,
)

function packageVersion() {
  const packageJsonPath = fileURLToPath(
    new URL('../package.json', import.meta.url),
  )
  const packageJson = JSON.parse(
    readFileSync(packageJsonPath, 'utf8'),
  ) as PackageJson

  return packageJson.version ?? '0.0.0'
}

function normalizeArgs(args: readonly string[]) {
  return args.filter((arg) => arg !== '--yes' && arg !== '-y')
}

function prepareTargetDirectory(targetDirectory: string, force: boolean) {
  const cwd = process.cwd()

  if (!existsSync(targetDirectory)) {
    mkdirSync(targetDirectory, { recursive: true })
    return
  }

  const entries = readdirSync(targetDirectory)

  if (entries.length === 0) {
    return
  }

  if (!force) {
    throw new Error(
      `Target directory is not empty: ${targetDirectory}. Pass --force to overwrite it.`,
    )
  }

  if (targetDirectory === cwd || targetDirectory === dirname(targetDirectory)) {
    throw new Error(
      'Refusing to overwrite the current or filesystem root directory',
    )
  }

  rmSync(targetDirectory, { recursive: true, force: true })
  mkdirSync(targetDirectory, { recursive: true })
}

function copyTemplate(targetDirectory: string, projectName: string) {
  const templateDirectory = fileURLToPath(
    new URL('../template', import.meta.url),
  )

  cpSync(templateDirectory, targetDirectory, { recursive: true })
  renameTemplateFiles(targetDirectory)
  patchPackageJson(targetDirectory, projectName)
}

function renameTemplateFiles(targetDirectory: string) {
  const renamedFiles = [
    ['_gitignore', '.gitignore'],
    ['_biome.json', 'biome.json'],
  ] as const

  for (const [from, to] of renamedFiles) {
    const templateFile = join(targetDirectory, from)

    if (existsSync(templateFile)) {
      renameSync(templateFile, join(targetDirectory, to))
    }
  }
}

function patchPackageJson(targetDirectory: string, projectName: string) {
  const packageJsonPath = join(targetDirectory, 'package.json')
  const packageJson = JSON.parse(
    readFileSync(packageJsonPath, 'utf8'),
  ) as TemplatePackageJson

  packageJson.name = projectName

  const coreSpec = process.env.SPECTER_CORE_SPEC

  if (coreSpec) {
    packageJson.dependencies = packageJson.dependencies ?? {}
    packageJson.dependencies['@specter-ts/core'] = coreSpec
  }

  writeFileSync(
    `${packageJsonPath}.tmp`,
    `${JSON.stringify(packageJson, null, 2)}\n`,
  )
  renameSync(`${packageJsonPath}.tmp`, packageJsonPath)
}

function runNpmInstall(targetDirectory: string) {
  return Effect.sync(() => {
    const result = spawnSync('npm', ['install'], {
      cwd: targetDirectory,
      stdio: 'inherit',
    })

    if (result.status !== 0) {
      throw new Error('npm install failed')
    }
  })
}

function packageNameFromDirectory(targetDirectory: string) {
  const baseName = targetDirectory.split(/[\\/]/).filter(Boolean).at(-1)
  const normalized = (baseName ?? 'specter-app')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || 'specter-app'
}

function successMessage(projectDirectory: string, installed: boolean) {
  const installStep = installed ? undefined : '  npm install'
  const lines = [
    `Created Specter project in ${projectDirectory}`,
    '',
    'Next steps:',
    `  cd ${projectDirectory}`,
    installStep,
    '  npm run dev',
    '',
    'Agent guidance: .agents/skills/specter/SKILL.md',
  ].filter((line): line is string => line !== undefined)

  return lines.join('\n')
}
