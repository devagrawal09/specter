import { isAbsolute, normalize, sep } from 'node:path'

import type {
  EvaluationCommand,
  FrozenProvenance,
  MatrixEntry,
  PackageProvenance,
} from './types.js'

const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const sha256Pattern = /^[a-f0-9]{64}$/
const commitPattern = /^[a-f0-9]{7,64}$/
const environmentNamePattern = /^[A-Z_][A-Z0-9_]*$/
const shellExecutables = new Set([
  'bash',
  'cmd',
  'cmd.exe',
  'dash',
  'fish',
  'powershell',
  'powershell.exe',
  'pwsh',
  'sh',
  'zsh',
])

export function validateMatrixEntry(value: unknown): MatrixEntry {
  const input = record(value, 'matrix entry')
  const domainId = id(input.domainId, 'domainId')
  const attemptNumber = literal(input.attemptNumber, [1, 2], 'attemptNumber')
  const expectedAttemptId = `${domainId}-${attemptNumber}`
  const attemptId = id(input.attemptId, 'attemptId')
  if (attemptId !== expectedAttemptId) {
    throw new Error(`attemptId must be ${expectedAttemptId}`)
  }

  const persistence = literal(
    input.persistence,
    ['sqlite', 'postgres'],
    'persistence',
  )
  const topology = literal(
    input.topology,
    ['single-process', 'multi-process'],
    'topology',
  )
  if (
    (persistence === 'sqlite' && topology !== 'single-process') ||
    (persistence === 'postgres' && topology !== 'multi-process')
  ) {
    throw new Error(
      'SQLite entries must be single-process and Postgres entries must be multi-process',
    )
  }

  const port = integer(input.port, 'port')
  if (port < 10000 || port > 65535) {
    throw new Error('port must be a fixed five-digit TCP port')
  }

  const freezePaths = array(input.freezePaths, 'freezePaths').map(
    (entry, index) => safeRelativePath(entry, `freezePaths[${index}]`),
  )
  if (freezePaths.length === 0) {
    throw new Error('freezePaths must contain at least one artifact path')
  }
  if (new Set(freezePaths).size !== freezePaths.length) {
    throw new Error('freezePaths must be unique')
  }
  const workspacePath = safeRelativePath(input.workspacePath, 'workspacePath')
  if (!freezePaths.includes(workspacePath)) {
    throw new Error('workspacePath must be included in freezePaths')
  }
  for (const path of freezePaths) {
    if (
      freezePaths.some(
        (candidate) =>
          candidate !== path && path.startsWith(`${candidate}${sep}`),
      )
    ) {
      throw new Error('freezePaths must not overlap')
    }
  }

  const visibleCommands = commands(input.visibleCommands, 'visibleCommands')
  const heldOutCommands = commands(input.heldOutCommands, 'heldOutCommands')
  if (visibleCommands.length === 0 || heldOutCommands.length === 0) {
    throw new Error('visibleCommands and heldOutCommands must not be empty')
  }
  const commandIds = [...visibleCommands, ...heldOutCommands].map(
    (command) => command.id,
  )
  if (new Set(commandIds).size !== commandIds.length) {
    throw new Error('command IDs must be unique across both suites')
  }

  return {
    attemptId,
    domainId,
    domainName: nonEmptyString(input.domainName, 'domainName'),
    domainKind: literal(
      input.domainKind,
      ['replication', 'transfer'],
      'domainKind',
    ),
    attemptNumber,
    persistence,
    topology,
    port,
    workspacePath,
    freezePaths,
    visibleCommands,
    heldOutCommands,
  }
}

export function validateProvenance(value: unknown): FrozenProvenance {
  const input = record(value, 'provenance')
  const packages = array(input.packages, 'packages').map((entry, index) =>
    packageProvenance(entry, `packages[${index}]`),
  )
  if (packages.length === 0) {
    throw new Error('packages must not be empty')
  }
  const names = packages.map((entry) => entry.name)
  if (new Set(names).size !== names.length) {
    throw new Error('package provenance names must be unique')
  }
  const guidanceFiles = array(input.guidanceFiles, 'guidanceFiles')
    .map((entry, index) => {
      const file = record(entry, `guidanceFiles[${index}]`)
      return {
        id: id(file.id, `guidanceFiles[${index}].id`),
        sha256: sha256(file.sha256, `guidanceFiles[${index}].sha256`),
      }
    })
    .sort((left, right) => left.id.localeCompare(right.id))
  if (guidanceFiles.length === 0) {
    throw new Error('guidanceFiles must not be empty')
  }
  if (
    new Set(guidanceFiles.map((file) => file.id)).size !== guidanceFiles.length
  ) {
    throw new Error('guidance file IDs must be unique')
  }

  return {
    specterCommit: matchingString(
      input.specterCommit,
      commitPattern,
      'specterCommit',
    ),
    promptSha256: sha256(input.promptSha256, 'promptSha256'),
    guidanceSha256: sha256(input.guidanceSha256, 'guidanceSha256'),
    guidanceFiles,
    briefSha256: sha256(input.briefSha256, 'briefSha256'),
    verifierSha256: sha256(input.verifierSha256, 'verifierSha256'),
    semanticCatalogSha256: sha256(
      input.semanticCatalogSha256,
      'semanticCatalogSha256',
    ),
    packages: packages.sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    model: nonEmptyString(input.model, 'model'),
    reasoningSetting: nonEmptyString(
      input.reasoningSetting,
      'reasoningSetting',
    ),
  }
}

export function safeRelativePath(value: unknown, name: string): string {
  const path = nonEmptyString(value, name)
  if (isAbsolute(path) || path.includes('\0')) {
    throw new Error(`${name} must be a safe relative path`)
  }
  const normalized = normalize(path)
  if (
    normalized === '..' ||
    normalized.startsWith(`..${sep}`) ||
    normalized === '.'
  ) {
    throw new Error(`${name} must stay below its configured root`)
  }
  return normalized
}

function commands(value: unknown, name: string): EvaluationCommand[] {
  return array(value, name).map((entry, index) => {
    const input = record(entry, `${name}[${index}]`)
    const args = array(input.args, `${name}[${index}].args`).map(
      (arg, argIndex) => string(arg, `${name}[${index}].args[${argIndex}]`),
    )
    const envInput = input.env
    let env: Record<string, string> | undefined
    if (envInput !== undefined) {
      env = {}
      for (const [key, rawValue] of Object.entries(
        record(envInput, `${name}[${index}].env`),
      ).sort(([left], [right]) => left.localeCompare(right))) {
        if (!environmentNamePattern.test(key)) {
          throw new Error(`${name}[${index}].env has invalid key ${key}`)
        }
        env[key] = string(rawValue, `${name}[${index}].env.${key}`)
      }
    }
    const file = nonEmptyString(input.file, `${name}[${index}].file`)
    const executableName = file.split(/[\\/]/).at(-1)?.toLowerCase()
    if (executableName && shellExecutables.has(executableName)) {
      throw new Error(`${name}[${index}].file must not invoke a command shell`)
    }
    const timeoutMs = integer(input.timeoutMs, `${name}[${index}].timeoutMs`)
    if (timeoutMs < 1 || timeoutMs > 60 * 60 * 1000) {
      throw new Error(`${name}[${index}].timeoutMs must be between 1ms and 1h`)
    }
    return {
      id: id(input.id, `${name}[${index}].id`),
      file,
      args,
      cwd: safeRelativePath(input.cwd, `${name}[${index}].cwd`),
      timeoutMs,
      ...(env ? { env } : {}),
    }
  })
}

function packageProvenance(value: unknown, name: string): PackageProvenance {
  const input = record(value, name)
  return {
    name: nonEmptyString(input.name, `${name}.name`),
    version: nonEmptyString(input.version, `${name}.version`),
    sha256: sha256(input.sha256, `${name}.sha256`),
  }
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
  return value as Record<string, unknown>
}

function array(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`)
  return value
}

function string(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`${name} must be a string`)
  return value
}

function nonEmptyString(value: unknown, name: string): string {
  const result = string(value, name)
  if (result.trim() === '') throw new Error(`${name} must not be empty`)
  return result
}

function matchingString(value: unknown, pattern: RegExp, name: string): string {
  const result = nonEmptyString(value, name)
  if (!pattern.test(result)) throw new Error(`${name} has an invalid format`)
  return result
}

function id(value: unknown, name: string): string {
  return matchingString(value, idPattern, name)
}

function sha256(value: unknown, name: string): string {
  return matchingString(value, sha256Pattern, name)
}

function integer(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${name} must be an integer`)
  }
  return value
}

function literal<const Value extends string | number>(
  value: unknown,
  values: readonly Value[],
  name: string,
): Value {
  if (!values.includes(value as Value)) {
    throw new Error(`${name} must be one of ${values.join(', ')}`)
  }
  return value as Value
}
