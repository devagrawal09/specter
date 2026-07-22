#!/usr/bin/env node
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

import { runGenerateCli } from './generate.js'

type TemplatePackageJson = {
  name?: string
  dependencies?: Record<string, string>
  overrides?: Record<string, string>
}

type PackageJson = {
  version?: string
}

if (process.argv[2] === 'generate') {
  try {
    runGenerateCli(process.argv.slice(2))
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : String(cause))
    process.exitCode = 1
  }
} else {
  try {
    runCreateCli(process.argv.slice(2))
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : String(cause))
    process.exitCode = 1
  }
}

function runCreateCli(rawArgs: readonly string[]) {
  const args = rawArgs.filter((arg) => arg !== '--yes' && arg !== '-y')
  if (args.includes('--version') || args.includes('-v')) {
    console.log(packageVersion())
    return
  }
  if (args.includes('--help') || args.includes('-h')) {
    console.log(
      'Usage: create-specter [project-directory] [--force] [--install]',
    )
    return
  }
  const projectDirectory =
    args.find((arg) => !arg.startsWith('-')) ?? 'my-specter-app'
  const force = args.includes('--force')
  const install = args.includes('--install')
  const targetDirectory = resolve(process.cwd(), projectDirectory)
  prepareTargetDirectory(targetDirectory, force)
  copyTemplate(targetDirectory, packageNameFromDirectory(targetDirectory))
  if (install) runNpmInstall(targetDirectory)
  console.log(successMessage(projectDirectory, install))
}

function packageVersion() {
  const packageJsonPath = fileURLToPath(
    new URL('../package.json', import.meta.url),
  )
  const packageJson = JSON.parse(
    readFileSync(packageJsonPath, 'utf8'),
  ) as PackageJson

  return packageJson.version ?? '0.0.0'
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
  const memorySpec = process.env.SPECTER_MEMORY_SPEC
  const reactionOutboxSpec = process.env.SPECTER_REACTION_OUTBOX_SPEC
  const sqliteSpec = process.env.SPECTER_SQLITE_SPEC

  if (coreSpec || memorySpec || reactionOutboxSpec || sqliteSpec) {
    packageJson.dependencies = packageJson.dependencies ?? {}
    if (coreSpec) packageJson.dependencies['@specter-ts/core'] = coreSpec
    if (memorySpec) packageJson.dependencies['@specter-ts/memory'] = memorySpec
    if (reactionOutboxSpec) {
      packageJson.dependencies['@specter-ts/reaction-outbox'] =
        reactionOutboxSpec
    }
    if (sqliteSpec) packageJson.dependencies['@specter-ts/sqlite'] = sqliteSpec
  }

  writeFileSync(
    `${packageJsonPath}.tmp`,
    `${JSON.stringify(packageJson, null, 2)}\n`,
  )
  renameSync(`${packageJsonPath}.tmp`, packageJsonPath)
}

function runNpmInstall(targetDirectory: string) {
  const result = spawnSync('npm', ['install'], {
    cwd: targetDirectory,
    stdio: 'inherit',
  })

  if (result.status !== 0) throw new Error('npm install failed')
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
