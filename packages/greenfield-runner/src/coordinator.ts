import { lstatSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { sha256, stableJson } from './storage.js'
import type {
  AdopterAssignment,
  CoordinatorCatalog,
  CoordinatorDomain,
  EvaluationCommand,
  EvaluationCommandTemplate,
  ExpectedProvenanceDigests,
  FrozenProvenance,
  MatrixEntry,
  ProvenanceBuildInput,
  RuntimeProvenance,
} from './types.js'
import { provenanceArtifactKinds } from './types.js'
import {
  safeRelativePath,
  validateMatrixEntry,
  validateProvenance,
} from './validation.js'

const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const sha256Pattern = /^[a-f0-9]{64}$/
const templateTokenPattern = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g

export function expandCoordinatorCatalog(value: unknown): MatrixEntry[] {
  const catalog = parseCatalog(value)
  const entries = catalog.domains.flatMap((domain) =>
    ([1, 2] as const).map((attemptNumber) => {
      const attemptId = `${domain.domainId}-${attemptNumber}`
      const replacements: Readonly<Record<string, string>> = {
        attemptId,
        attemptNumber: String(attemptNumber),
        domainId: domain.domainId,
        domainKind: domain.domainKind,
        persistence: domain.persistence,
        port: String(domain.port),
        topology:
          domain.persistence === 'sqlite' ? 'single-process' : 'multi-process',
        workspacePath: catalog.workspacePath,
      }
      return validateMatrixEntry({
        attemptId,
        domainId: domain.domainId,
        domainName: domain.domainName,
        domainKind: domain.domainKind,
        attemptNumber,
        persistence: domain.persistence,
        topology: replacements.topology,
        port: domain.port,
        workspacePath: catalog.workspacePath,
        freezePaths: catalog.freezePaths,
        visibleCommands: catalog.visibleCommands.map((command) =>
          expandCommand(command, replacements),
        ),
        heldOutCommands: catalog.heldOutCommands.map((command) =>
          expandCommand(command, replacements),
        ),
      })
    }),
  )
  return validateCompleteMatrix(entries)
}

export function validateCompleteMatrix(value: unknown): MatrixEntry[] {
  if (!Array.isArray(value)) throw new Error('matrix must be an array')
  const entries = value
    .map(validateMatrixEntry)
    .sort((left, right) => left.attemptId.localeCompare(right.attemptId))
  if (entries.length !== 10) {
    throw new Error('matrix must contain exactly ten attempts')
  }
  if (
    new Set(entries.map((entry) => entry.attemptId)).size !== entries.length
  ) {
    throw new Error('matrix attempt IDs must be unique')
  }

  const domains = new Map<string, MatrixEntry[]>()
  for (const entry of entries) {
    const attempts = domains.get(entry.domainId) ?? []
    attempts.push(entry)
    domains.set(entry.domainId, attempts)
  }
  if (domains.size !== 5) throw new Error('matrix must contain five domains')

  const representatives: MatrixEntry[] = []
  for (const [domainId, attempts] of [...domains.entries()].sort()) {
    if (
      attempts.length !== 2 ||
      attempts[0]?.attemptNumber === attempts[1]?.attemptNumber
    ) {
      throw new Error(`${domainId} must have attempts 1 and 2 exactly once`)
    }
    const [first, second] = attempts.sort(
      (left, right) => left.attemptNumber - right.attemptNumber,
    )
    if (!first || !second)
      throw new Error(`${domainId} attempts are incomplete`)
    for (const key of [
      'domainName',
      'domainKind',
      'persistence',
      'topology',
      'port',
      'workspacePath',
    ] as const) {
      if (first[key] !== second[key]) {
        throw new Error(`${domainId} must keep ${key} fixed across attempts`)
      }
    }
    if (stableJson(first.freezePaths) !== stableJson(second.freezePaths)) {
      throw new Error(`${domainId} must keep freezePaths fixed across attempts`)
    }
    representatives.push(first)
  }

  if (new Set(representatives.map((entry) => entry.port)).size !== 5) {
    throw new Error('each domain must have a unique fixed port')
  }
  requireCohortCount(representatives, 'persistence', 'sqlite', 3)
  requireCohortCount(representatives, 'persistence', 'postgres', 2)
  requireCohortCount(representatives, 'domainKind', 'replication', 3)
  requireCohortCount(representatives, 'domainKind', 'transfer', 2)
  return entries
}

export function toAdopterAssignment(value: unknown): AdopterAssignment {
  const entry = validateMatrixEntry(value)
  return {
    attemptId: entry.attemptId,
    domainId: entry.domainId,
    domainName: entry.domainName,
    domainKind: entry.domainKind,
    attemptNumber: entry.attemptNumber,
    persistence: entry.persistence,
    topology: entry.topology,
    port: entry.port,
    workspacePath: entry.workspacePath,
    freezePaths: entry.freezePaths,
    visibleCommands: entry.visibleCommands,
  }
}

export function buildFrozenProvenance(value: unknown): FrozenProvenance {
  const input = parseProvenanceBuildInput(value)
  const artifacts = input.artifacts
    .map((artifact) => ({
      id: artifact.id,
      audience: artifact.audience,
      kind: artifact.kind,
      sha256: digestFile(artifact.path),
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
  const packages = input.packageTarballs
    .map((item) => ({
      name: item.name,
      version: item.version,
      artifactId: item.artifactId,
      sha256: digestFile(item.path),
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
  const provenance = validateProvenance({
    specterCommit: input.specterCommit,
    artifactManifestSha256: sha256(stableJson(artifacts)),
    artifacts,
    packages,
    runtime: input.runtime,
  })
  validateExpectedDigests(provenance, input.expected)
  return provenance
}

function parseCatalog(value: unknown): CoordinatorCatalog {
  const input = record(value, 'catalog')
  const workspacePath = safeRelativePath(input.workspacePath, 'workspacePath')
  const freezePaths = array(input.freezePaths, 'freezePaths').map(
    (path, index) => safeRelativePath(path, `freezePaths[${index}]`),
  )
  if (!freezePaths.includes(workspacePath)) {
    throw new Error('workspacePath must be included in freezePaths')
  }
  const domains = array(input.domains, 'domains').map(parseDomain)
  const visibleCommands = parseCommandTemplates(
    input.visibleCommands,
    'visibleCommands',
  )
  const heldOutCommands = parseCommandTemplates(
    input.heldOutCommands,
    'heldOutCommands',
  )
  return {
    domains,
    workspacePath,
    freezePaths,
    visibleCommands,
    heldOutCommands,
  }
}

function parseDomain(value: unknown, index: number): CoordinatorDomain {
  const input = record(value, `domains[${index}]`)
  return {
    domainId: id(input.domainId, `domains[${index}].domainId`),
    domainName: nonEmptyString(
      input.domainName,
      `domains[${index}].domainName`,
    ),
    domainKind: literal(
      input.domainKind,
      ['replication', 'transfer'],
      `domains[${index}].domainKind`,
    ),
    persistence: literal(
      input.persistence,
      ['sqlite', 'postgres'],
      `domains[${index}].persistence`,
    ),
    port: boundedInteger(input.port, `domains[${index}].port`, 10000, 65535),
  }
}

function parseCommandTemplates(
  value: unknown,
  name: string,
): EvaluationCommandTemplate[] {
  const templates = array(value, name).map((item, index) => {
    const input = record(item, `${name}[${index}]`)
    const envValue = input.env
    let env: Record<string, string> | undefined
    if (envValue !== undefined) {
      env = Object.fromEntries(
        Object.entries(record(envValue, `${name}[${index}].env`)).map(
          ([key, entry]) => [
            key,
            string(entry, `${name}[${index}].env.${key}`),
          ],
        ),
      )
    }
    return {
      id: nonEmptyString(input.id, `${name}[${index}].id`),
      file: nonEmptyString(input.file, `${name}[${index}].file`),
      args: array(input.args, `${name}[${index}].args`).map(
        (argument, offset) =>
          string(argument, `${name}[${index}].args[${offset}]`),
      ),
      cwd: nonEmptyString(input.cwd, `${name}[${index}].cwd`),
      timeoutMs: boundedInteger(
        input.timeoutMs,
        `${name}[${index}].timeoutMs`,
        1,
        60 * 60 * 1000,
      ),
      ...(env ? { env } : {}),
    }
  })
  if (templates.length === 0) throw new Error(`${name} must not be empty`)
  return templates
}

function expandCommand(
  template: EvaluationCommandTemplate,
  replacements: Readonly<Record<string, string>>,
): EvaluationCommand {
  const expand = (value: string): string =>
    value.replace(templateTokenPattern, (_match, token: string) => {
      const replacement = replacements[token]
      if (replacement === undefined) {
        throw new Error(`Unknown coordinator template token: {${token}}`)
      }
      return replacement
    })
  return {
    id: expand(template.id),
    file: expand(template.file),
    args: template.args.map(expand),
    cwd: expand(template.cwd),
    timeoutMs: template.timeoutMs,
    ...(template.env
      ? {
          env: Object.fromEntries(
            Object.entries(template.env).map(([key, value]) => [
              key,
              expand(value),
            ]),
          ),
        }
      : {}),
  }
}

function parseProvenanceBuildInput(value: unknown): ProvenanceBuildInput {
  const input = record(value, 'provenance build input')
  const artifacts = array(input.artifacts, 'artifacts').map((item, index) => {
    const artifact = record(item, `artifacts[${index}]`)
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
      path: nonEmptyString(artifact.path, `artifacts[${index}].path`),
    }
  })
  if (
    new Set(artifacts.map((artifact) => artifact.id)).size !== artifacts.length
  ) {
    throw new Error('artifact IDs must be unique')
  }
  requireArtifactKinds(artifacts)
  const packageTarballs = array(input.packageTarballs, 'packageTarballs').map(
    (item, index) => {
      const packageInput = record(item, `packageTarballs[${index}]`)
      return {
        name: nonEmptyString(
          packageInput.name,
          `packageTarballs[${index}].name`,
        ),
        version: nonEmptyString(
          packageInput.version,
          `packageTarballs[${index}].version`,
        ),
        artifactId: id(
          packageInput.artifactId,
          `packageTarballs[${index}].artifactId`,
        ),
        path: nonEmptyString(
          packageInput.path,
          `packageTarballs[${index}].path`,
        ),
      }
    },
  )
  if (packageTarballs.length === 0) {
    throw new Error('packageTarballs must not be empty')
  }
  for (const item of packageTarballs) {
    const artifact = artifacts.find(
      (candidate) => candidate.id === item.artifactId,
    )
    if (artifact?.kind !== 'specterPackage' || artifact.audience !== 'public') {
      throw new Error(
        `package ${item.name} must reference a public specterPackage artifact`,
      )
    }
    if (resolve(artifact.path) !== resolve(item.path)) {
      throw new Error(
        `package ${item.name} path must match artifact ${item.artifactId}`,
      )
    }
  }
  return {
    specterCommit: nonEmptyString(input.specterCommit, 'specterCommit'),
    artifacts,
    packageTarballs,
    runtime: parseRuntime(input.runtime),
    ...(input.expected === undefined
      ? {}
      : { expected: parseExpectedDigests(input.expected) }),
  }
}

function parseExpectedDigests(value: unknown): ExpectedProvenanceDigests {
  const input = record(value, 'expected')
  const knownKeys = new Set([
    'artifactManifestSha256',
    'artifacts',
    'packageTarballs',
  ])
  for (const key of Object.keys(input)) {
    if (!knownKeys.has(key)) throw new Error(`Unknown expected digest: ${key}`)
  }
  return {
    ...optionalDigest(input, 'artifactManifestSha256'),
    ...optionalDigestRecord(input, 'artifacts'),
    ...optionalDigestRecord(input, 'packageTarballs'),
  }
}

function validateExpectedDigests(
  provenance: FrozenProvenance,
  expected: ExpectedProvenanceDigests | undefined,
): void {
  if (!expected) return
  if (
    expected.artifactManifestSha256 !== undefined &&
    expected.artifactManifestSha256 !== provenance.artifactManifestSha256
  ) {
    throw new Error(
      `Digest mismatch for artifactManifestSha256: expected ${expected.artifactManifestSha256}, received ${provenance.artifactManifestSha256}`,
    )
  }
  validateExpectedRecord(
    'artifact',
    Object.fromEntries(
      provenance.artifacts.map((artifact) => [artifact.id, artifact.sha256]),
    ),
    expected.artifacts,
  )
  validateExpectedRecord(
    'package tarball',
    Object.fromEntries(
      provenance.packages.map((item) => [item.name, item.sha256]),
    ),
    expected.packageTarballs,
  )
}

function validateExpectedRecord(
  label: string,
  actual: Readonly<Record<string, string>>,
  expected: Readonly<Record<string, string>> | undefined,
): void {
  if (!expected) return
  for (const [id, digest] of Object.entries(expected)) {
    if (actual[id] === undefined)
      throw new Error(`Unknown expected ${label}: ${id}`)
    if (actual[id] !== digest) {
      throw new Error(
        `Digest mismatch for ${label} ${id}: expected ${digest}, received ${actual[id]}`,
      )
    }
  }
}

function digestFile(path: string): string {
  const absolutePath = resolve(path)
  const stats = lstatSync(absolutePath)
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(
      `Provenance input must be a regular non-symlink file: ${path}`,
    )
  }
  return sha256(readFileSync(absolutePath))
}

function requireCohortCount(
  entries: readonly MatrixEntry[],
  key: 'persistence' | 'domainKind',
  value: string,
  expected: number,
): void {
  const actual = entries.filter((entry) => entry[key] === value).length
  if (actual !== expected) {
    throw new Error(`matrix must contain ${expected} ${value} domain profiles`)
  }
}

function optionalDigest(
  input: Record<string, unknown>,
  key: keyof ExpectedProvenanceDigests,
): object {
  return input[key] === undefined
    ? {}
    : { [key]: digest(input[key], `expected.${key}`) }
}

function optionalDigestRecord(
  input: Record<string, unknown>,
  key: 'artifacts' | 'packageTarballs',
): object {
  if (input[key] === undefined) return {}
  return {
    [key]: Object.fromEntries(
      Object.entries(record(input[key], `expected.${key}`)).map(
        ([id, value]) => [id, digest(value, `expected.${key}.${id}`)],
      ),
    ),
  }
}

const publicArtifactKinds = new Set([
  'adopterPrompt',
  'domainBrief',
  'guidance',
  'initializer',
  'semanticCatalog',
  'semanticMapContract',
  'specterPackage',
  'visibleSuite',
])

function requireArtifactKinds(
  artifacts: ProvenanceBuildInput['artifacts'],
): void {
  if (artifacts.length === 0) throw new Error('artifacts must not be empty')
  for (const kind of provenanceArtifactKinds) {
    if (!artifacts.some((artifact) => artifact.kind === kind)) {
      throw new Error(`artifacts must include at least one ${kind} artifact`)
    }
  }
  for (const artifact of artifacts) {
    const expectedAudience = publicArtifactKinds.has(artifact.kind)
      ? 'public'
      : 'private'
    if (artifact.audience !== expectedAudience) {
      throw new Error(
        `${artifact.kind} artifact ${artifact.id} must be ${expectedAudience}`,
      )
    }
  }
}

function parseRuntime(value: unknown): RuntimeProvenance {
  const input = record(value, 'runtime')
  const model = record(input.model, 'runtime.model')
  const sampler = Object.fromEntries(
    Object.entries(record(model.sampler, 'runtime.model.sampler'))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => {
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
        return [key, entry]
      }),
  )
  const harness = record(input.agentHarness, 'runtime.agentHarness')
  const platform = record(input.platform, 'runtime.platform')
  const toolchain = record(input.toolchain, 'runtime.toolchain')
  const services = array(input.services, 'runtime.services')
    .map((item, index) => {
      const service = record(item, `runtime.services[${index}]`)
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
  return {
    model: {
      provider: nonEmptyString(model.provider, 'runtime.model.provider'),
      id: nonEmptyString(model.id, 'runtime.model.id'),
      build: nonEmptyString(model.build, 'runtime.model.build'),
      reasoningSetting: nonEmptyString(
        model.reasoningSetting,
        'runtime.model.reasoningSetting',
      ),
      sampler,
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
    runOrderSeed: nonEmptyString(input.runOrderSeed, 'runtime.runOrderSeed'),
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

function id(value: unknown, name: string): string {
  const result = nonEmptyString(value, name)
  if (!idPattern.test(result)) throw new Error(`${name} has an invalid format`)
  return result
}

function digest(value: unknown, name: string): string {
  const result = string(value, name)
  if (!sha256Pattern.test(result)) {
    throw new Error(`${name} must be a lowercase SHA-256 digest`)
  }
  return result
}

function boundedInteger(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`)
  }
  return value
}

function literal<const Value extends string>(
  value: unknown,
  values: readonly Value[],
  name: string,
): Value {
  if (!values.includes(value as Value)) {
    throw new Error(`${name} must be one of ${values.join(', ')}`)
  }
  return value as Value
}
