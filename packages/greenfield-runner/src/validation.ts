import { isAbsolute, normalize, sep } from 'node:path'

import { sha256 as hashBytes, stableJson } from './storage.js'
import type {
  EvaluationCommand,
  FrozenProvenance,
  MatrixEntry,
  PackageProvenance,
  RuntimeProvenance,
} from './types.js'
import { provenanceArtifactKinds } from './types.js'

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
  const artifacts = array(input.artifacts, 'artifacts')
    .map((entry, index) => {
      const artifact = record(entry, `artifacts[${index}]`)
      return {
        id: id(artifact.id, `artifacts[${index}].id`),
        audience: literal(
          artifact.audience,
          ['public', 'private'],
          `artifacts[${index}].audience`,
        ),
        kind: literal(
          artifact.kind,
          provenanceArtifactKinds,
          `artifacts[${index}].kind`,
        ),
        sha256: sha256(artifact.sha256, `artifacts[${index}].sha256`),
      }
    })
    .sort((left, right) => left.id.localeCompare(right.id))
  if (artifacts.length === 0) throw new Error('artifacts must not be empty')
  if (
    new Set(artifacts.map((artifact) => artifact.id)).size !== artifacts.length
  ) {
    throw new Error('artifact IDs must be unique')
  }
  for (const kind of provenanceArtifactKinds) {
    if (!artifacts.some((artifact) => artifact.kind === kind)) {
      throw new Error(`artifacts must include at least one ${kind} artifact`)
    }
  }
  for (const kind of [
    'candidateTable',
    'developerPolicy',
    'environmentFailureSignatures',
    'frictionCodebook',
    'methodology',
    'randomizedSchedule',
    'recommendationEvidenceMap',
    'reviewerAssignment',
    'systemPolicy',
    'toolPolicy',
    'verificationPlan',
  ] as const) {
    if (artifacts.filter((artifact) => artifact.kind === kind).length !== 1) {
      throw new Error(`artifacts must include exactly one ${kind} artifact`)
    }
  }
  const publicKinds = new Set([
    'adopterPrompt',
    'domainBrief',
    'guidance',
    'initializer',
    'semanticCatalog',
    'semanticMapContract',
    'specterPackage',
    'visibleSuite',
  ])
  for (const artifact of artifacts) {
    const expectedAudience = publicKinds.has(artifact.kind)
      ? 'public'
      : 'private'
    if (artifact.audience !== expectedAudience) {
      throw new Error(
        `${artifact.kind} artifact ${artifact.id} must be ${expectedAudience}`,
      )
    }
  }
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
  for (const item of packages) {
    const artifact = artifacts.find(
      (candidate) => candidate.id === item.artifactId,
    )
    if (
      artifact?.kind !== 'specterPackage' ||
      artifact.audience !== 'public' ||
      artifact.sha256 !== item.sha256
    ) {
      throw new Error(
        `package ${item.name} must reference its matching public specterPackage artifact`,
      )
    }
  }
  const runtime = validateRuntimeProvenance(input.runtime)

  const artifactManifestSha256 = sha256(
    input.artifactManifestSha256,
    'artifactManifestSha256',
  )
  const computedManifestSha256 = hashBytes(stableJson(artifacts))
  if (artifactManifestSha256 !== computedManifestSha256) {
    throw new Error(
      `artifactManifestSha256 does not match artifacts: expected ${computedManifestSha256}`,
    )
  }

  return {
    specterCommit: matchingString(
      input.specterCommit,
      commitPattern,
      'specterCommit',
    ),
    artifactManifestSha256,
    artifacts,
    packages: packages.sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    runtime,
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
    artifactId: id(input.artifactId, `${name}.artifactId`),
    sha256: sha256(input.sha256, `${name}.sha256`),
  }
}

export function validateRuntimeProvenance(value: unknown): RuntimeProvenance {
  const input = record(value, 'runtime')
  const model = record(input.model, 'runtime.model')
  const sampler = record(model.sampler, 'runtime.model.sampler')
  for (const [key, entry] of Object.entries(sampler)) {
    if (
      entry !== null &&
      typeof entry !== 'boolean' &&
      typeof entry !== 'number' &&
      typeof entry !== 'string'
    ) {
      throw new Error(`runtime.model.sampler.${key} must be a JSON scalar`)
    }
    if (typeof entry === 'number' && !Number.isFinite(entry)) {
      throw new Error(`runtime.model.sampler.${key} must be finite`)
    }
  }
  const harness = record(input.agentHarness, 'runtime.agentHarness')
  const platform = record(input.platform, 'runtime.platform')
  const toolchain = record(input.toolchain, 'runtime.toolchain')
  const executionImage = record(input.executionImage, 'runtime.executionImage')
  const resourceLimits = record(input.resourceLimits, 'runtime.resourceLimits')
  const dependencyCache = record(
    input.dependencyCache,
    'runtime.dependencyCache',
  )
  const services = array(input.services, 'runtime.services')
    .map((entry, index) => {
      const service = record(entry, `runtime.services[${index}]`)
      return {
        id: id(service.id, `runtime.services[${index}].id`),
        version: nonEmptyString(
          service.version,
          `runtime.services[${index}].version`,
        ),
        ...(service.digest === undefined
          ? {}
          : {
              digest: nonEmptyString(
                service.digest,
                `runtime.services[${index}].digest`,
              ),
            }),
      }
    })
    .sort((left, right) => left.id.localeCompare(right.id))
  if (new Set(services.map((service) => service.id)).size !== services.length) {
    throw new Error('runtime service IDs must be unique')
  }
  const imageInputs = array(input.imageInputs, 'runtime.imageInputs')
    .map((entry, index) => {
      const image = record(entry, `runtime.imageInputs[${index}]`)
      return {
        id: id(image.id, `runtime.imageInputs[${index}].id`),
        sha256: sha256(image.sha256, `runtime.imageInputs[${index}].sha256`),
      }
    })
    .sort((left, right) => left.id.localeCompare(right.id))
  if (
    new Set(imageInputs.map((image) => image.id)).size !== imageInputs.length
  ) {
    throw new Error('runtime image input IDs must be unique')
  }
  const runOrder = array(input.runOrder, 'runtime.runOrder').map(
    (entry, index) => id(entry, `runtime.runOrder[${index}]`),
  )
  if (runOrder.length !== 10 || new Set(runOrder).size !== 10) {
    throw new Error('runtime.runOrder must contain exactly ten unique attempts')
  }
  const freshContexts = array(input.freshContexts, 'runtime.freshContexts')
    .map((entry, index) => {
      const context = record(entry, `runtime.freshContexts[${index}]`)
      if (context.freshTask !== true || context.parentTaskId !== null) {
        throw new Error(
          `runtime.freshContexts[${index}] must attest a fresh task with no parent task`,
        )
      }
      return {
        attemptId: id(
          context.attemptId,
          `runtime.freshContexts[${index}].attemptId`,
        ),
        taskId: nonEmptyString(
          context.taskId,
          `runtime.freshContexts[${index}].taskId`,
        ),
        initialContextTokens: integer(
          context.initialContextTokens,
          `runtime.freshContexts[${index}].initialContextTokens`,
        ),
        freshTask: true as const,
        parentTaskId: null,
      }
    })
    .sort((left, right) => left.attemptId.localeCompare(right.attemptId))
  if (
    freshContexts.length !== 10 ||
    new Set(freshContexts.map((context) => context.attemptId)).size !== 10 ||
    new Set(freshContexts.map((context) => context.taskId)).size !== 10 ||
    freshContexts.some(
      (context) =>
        context.initialContextTokens < 0 ||
        !runOrder.includes(context.attemptId),
    )
  ) {
    throw new Error(
      'runtime.freshContexts must contain one unique nonnegative fresh-task record per scheduled attempt',
    )
  }
  return {
    model: {
      provider: nonEmptyString(model.provider, 'runtime.model.provider'),
      id: nonEmptyString(model.id, 'runtime.model.id'),
      build: nonEmptyString(model.build, 'runtime.model.build'),
      reasoningSetting: nonEmptyString(
        model.reasoningSetting,
        'runtime.model.reasoningSetting',
      ),
      sampler: Object.fromEntries(
        Object.entries(sampler).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ) as FrozenProvenance['runtime']['model']['sampler'],
    },
    agentHarness: {
      name: nonEmptyString(harness.name, 'runtime.agentHarness.name'),
      version: nonEmptyString(harness.version, 'runtime.agentHarness.version'),
    },
    platform: {
      operatingSystem: nonEmptyString(
        platform.operatingSystem,
        'runtime.platform.operatingSystem',
      ),
      release: nonEmptyString(platform.release, 'runtime.platform.release'),
      architecture: nonEmptyString(
        platform.architecture,
        'runtime.platform.architecture',
      ),
    },
    toolchain: {
      node: nonEmptyString(toolchain.node, 'runtime.toolchain.node'),
      packageManager: nonEmptyString(
        toolchain.packageManager,
        'runtime.toolchain.packageManager',
      ),
      browser: nonEmptyString(toolchain.browser, 'runtime.toolchain.browser'),
      browserRevision: nonEmptyString(
        toolchain.browserRevision,
        'runtime.toolchain.browserRevision',
      ),
    },
    services,
    executionImage: {
      name: nonEmptyString(executionImage.name, 'runtime.executionImage.name'),
      sha256: sha256(executionImage.sha256, 'runtime.executionImage.sha256'),
    },
    resourceLimits: {
      contextTokens: positiveInteger(
        resourceLimits.contextTokens,
        'runtime.resourceLimits.contextTokens',
      ),
      cpuCores: positiveNumber(
        resourceLimits.cpuCores,
        'runtime.resourceLimits.cpuCores',
      ),
      memoryMiB: positiveInteger(
        resourceLimits.memoryMiB,
        'runtime.resourceLimits.memoryMiB',
      ),
      activeMinutes: exactInteger(
        resourceLimits.activeMinutes,
        180,
        'runtime.resourceLimits.activeMinutes',
      ),
      checkpointMinutes: exactInteger(
        resourceLimits.checkpointMinutes,
        75,
        'runtime.resourceLimits.checkpointMinutes',
      ),
      remediationMinutes: exactInteger(
        resourceLimits.remediationMinutes,
        60,
        'runtime.resourceLimits.remediationMinutes',
      ),
    },
    dependencyCache: {
      id: nonEmptyString(dependencyCache.id, 'runtime.dependencyCache.id'),
      sha256: sha256(dependencyCache.sha256, 'runtime.dependencyCache.sha256'),
    },
    imageInputs,
    runOrderSeed: nonEmptyString(input.runOrderSeed, 'runtime.runOrderSeed'),
    runOrder,
    freshContexts,
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

function positiveInteger(value: unknown, name: string): number {
  const result = integer(value, name)
  if (result < 1) throw new Error(`${name} must be positive`)
  return result
}

function positiveNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`)
  }
  return value
}

function exactInteger<const Value extends number>(
  value: unknown,
  expected: Value,
  name: string,
): Value {
  if (integer(value, name) !== expected) {
    throw new Error(`${name} must be ${expected}`)
  }
  return expected
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
