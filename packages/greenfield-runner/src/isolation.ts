import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'

import { readJson, stableJson } from './storage.js'
import type { PreparedAttempt } from './types.js'

export interface AdopterIsolationContract {
  readonly schemaVersion: 1
  readonly attemptId: string
  readonly configSha256: string
  readonly coordinatorRoot: string
  readonly adopterRoot: string
  readonly publicCanaryPaths: readonly string[]
  readonly privateCanaryPaths: readonly string[]
}

export interface IsolationRehearsalResult {
  readonly schemaVersion: 1
  readonly attemptId: string
  readonly configSha256: string
  readonly coordinatorRoot: string
  readonly adopterRoot: string
  readonly publicCanaryPaths: readonly string[]
  readonly privateCanaryPaths: readonly string[]
  readonly rehearsedAt: string
  readonly passed: boolean
  readonly publicReadable: readonly string[]
  readonly privateBlocked: readonly string[]
  readonly failures: readonly string[]
}

export type PassingIsolationAttestation = IsolationRehearsalResult & {
  readonly passed: true
  readonly failures: readonly []
}

const attestationFile = 'isolation-attestation.json'

export function assertPhysicallySeparateRoots(
  coordinatorRootValue: string,
  adopterRootValue: string,
): { readonly coordinatorRoot: string; readonly adopterRoot: string } {
  const coordinatorRoot = directory(coordinatorRootValue, 'coordinatorRoot')
  const adopterRoot = directory(adopterRootValue, 'adopterRoot')
  if (
    contains(coordinatorRoot, adopterRoot) ||
    contains(adopterRoot, coordinatorRoot)
  ) {
    throw new Error(
      'coordinatorRoot and adopterRoot must be physically separate',
    )
  }
  return { coordinatorRoot, adopterRoot }
}

/** Run from inside the actual adopter sandbox/container. */
export function rehearseAdopterAccessIsolation(
  value: unknown,
  now: Date = new Date(),
): IsolationRehearsalResult {
  const contract = parseIsolationContract(value)
  const failures: string[] = []
  const publicReadable: string[] = []
  const privateBlocked: string[] = []
  for (const path of contract.publicCanaryPaths) {
    try {
      readFileSync(path)
      publicReadable.push(path)
    } catch (cause) {
      failures.push(
        `public canary is not readable: ${path} (${message(cause)})`,
      )
    }
  }
  for (const path of contract.privateCanaryPaths) {
    try {
      readFileSync(path)
      failures.push(`private canary is readable from adopter sandbox: ${path}`)
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code
      if (code === 'EACCES' || code === 'ENOENT' || code === 'EPERM') {
        privateBlocked.push(path)
      } else {
        failures.push(
          `private canary failed unexpectedly: ${path} (${message(cause)})`,
        )
      }
    }
  }
  return {
    ...contract,
    rehearsedAt: now.toISOString(),
    passed: failures.length === 0,
    publicReadable,
    privateBlocked,
    failures,
  }
}

export function parseIsolationContract(
  value: unknown,
): AdopterIsolationContract {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('isolation contract must be an object')
  }
  const input = value as Record<string, unknown>
  if (input.schemaVersion !== 1) throw new Error('schemaVersion must be 1')
  const attemptId = nonEmptyString(input.attemptId, 'attemptId')
  const configSha256 = sha256(input.configSha256, 'configSha256')
  const coordinatorRoot = absolute(input.coordinatorRoot, 'coordinatorRoot')
  const adopterRoot = directory(input.adopterRoot, 'adopterRoot')
  if (
    contains(coordinatorRoot, adopterRoot) ||
    contains(adopterRoot, coordinatorRoot)
  ) {
    throw new Error(
      'coordinatorRoot and adopterRoot must be physically separate',
    )
  }
  const publicCanaryPaths = paths(input.publicCanaryPaths, 'publicCanaryPaths')
  const privateCanaryPaths = paths(
    input.privateCanaryPaths,
    'privateCanaryPaths',
  )
  if (publicCanaryPaths.length === 0 || privateCanaryPaths.length === 0) {
    throw new Error(
      'publicCanaryPaths and privateCanaryPaths must not be empty',
    )
  }
  for (const path of publicCanaryPaths) {
    if (!contains(adopterRoot, path))
      throw new Error(`public canary must be below adopterRoot: ${path}`)
  }
  for (const path of privateCanaryPaths) {
    if (!contains(coordinatorRoot, path))
      throw new Error(`private canary must be below coordinatorRoot: ${path}`)
  }
  return {
    schemaVersion: 1,
    attemptId,
    configSha256,
    coordinatorRoot,
    adopterRoot,
    publicCanaryPaths,
    privateCanaryPaths,
  }
}

/** Persist only coordinator-captured, passing evidence for this exact attempt. */
export function recordPassingIsolationAttestation(
  attemptDirectoryValue: string,
  value: unknown,
): PassingIsolationAttestation {
  const attemptDirectory = directory(attemptDirectoryValue, 'attemptDirectory')
  const prepared = readJson(
    resolve(attemptDirectory, 'frozen-provenance.json'),
  ) as PreparedAttempt
  const attestation = parsePassingAttestation(value)
  assertAttestationBinding(attemptDirectory, prepared, attestation)
  for (const path of [
    ...attestation.publicCanaryPaths,
    ...attestation.privateCanaryPaths,
  ]) {
    if (!existsSync(path) || !lstatSync(path).isFile()) {
      throw new Error(`isolation canary must exist as a regular file: ${path}`)
    }
  }
  writeFileSync(
    resolve(attemptDirectory, attestationFile),
    `${stableJson(attestation)}\n`,
    { flag: 'wx' },
  )
  return attestation
}

/** Revalidate persisted evidence before every scored or coordinator-only phase. */
export function assertPassingIsolationAttestation(
  attemptDirectoryValue: string,
): PassingIsolationAttestation {
  const attemptDirectory = directory(attemptDirectoryValue, 'attemptDirectory')
  const prepared = readJson(
    resolve(attemptDirectory, 'frozen-provenance.json'),
  ) as PreparedAttempt
  const path = resolve(attemptDirectory, attestationFile)
  if (!existsSync(path)) {
    throw new Error(
      'A persisted passing isolation attestation is required for this attempt',
    )
  }
  const attestation = parsePassingAttestation(readJson(path))
  assertAttestationBinding(attemptDirectory, prepared, attestation)
  return attestation
}

function parsePassingAttestation(value: unknown): PassingIsolationAttestation {
  const input = record(value, 'isolation attestation')
  const contract = parseIsolationContract(input)
  if (input.passed !== true || !Array.isArray(input.failures)) {
    throw new Error('isolation attestation must record a passing rehearsal')
  }
  if (input.failures.length !== 0) {
    throw new Error('passing isolation attestation must have no failures')
  }
  const publicReadable = paths(input.publicReadable, 'publicReadable')
  const privateBlocked = paths(input.privateBlocked, 'privateBlocked')
  if (!samePaths(publicReadable, contract.publicCanaryPaths)) {
    throw new Error('isolation attestation did not read every public canary')
  }
  if (!samePaths(privateBlocked, contract.privateCanaryPaths)) {
    throw new Error('isolation attestation did not block every private canary')
  }
  const rehearsedAt = nonEmptyString(input.rehearsedAt, 'rehearsedAt')
  if (Number.isNaN(Date.parse(rehearsedAt))) {
    throw new Error('rehearsedAt must be an ISO timestamp')
  }
  return {
    ...contract,
    rehearsedAt,
    passed: true,
    publicReadable,
    privateBlocked,
    failures: [],
  }
}

function assertAttestationBinding(
  attemptDirectory: string,
  prepared: PreparedAttempt,
  attestation: PassingIsolationAttestation,
): void {
  const expected = {
    attemptId: prepared.assignment.attemptId,
    configSha256: prepared.configSha256,
    coordinatorRoot: attemptDirectory,
    adopterRoot: physicalPath(resolve(prepared.adopterDirectory)),
  }
  for (const [name, expectedValue] of Object.entries(expected)) {
    if (attestation[name as keyof typeof attestation] !== expectedValue) {
      throw new Error(
        `isolation attestation binding mismatch for ${name}: expected ${expectedValue}`,
      )
    }
  }
}

function directory(value: unknown, name: string): string {
  const path = absolute(value, name)
  const stats = lstatSync(path)
  if (stats.isSymbolicLink() || !stats.isDirectory())
    throw new Error(`${name} must be a non-symlink directory`)
  return realpathSync(path)
}

function paths(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`)
  const result = value.map((entry, index) =>
    absolute(entry, `${name}[${index}]`),
  )
  if (new Set(result).size !== result.length) {
    throw new Error(`${name} must not contain duplicates`)
  }
  return result
}

function absolute(value: unknown, name: string): string {
  if (typeof value !== 'string' || !isAbsolute(value))
    throw new Error(`${name} must be an absolute path`)
  return physicalPath(resolve(value))
}

function physicalPath(path: string): string {
  let existingAncestor = path
  const missingSegments: string[] = []
  while (true) {
    try {
      return resolve(
        realpathSync(existingAncestor),
        ...missingSegments.reverse(),
      )
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
      const parent = dirname(existingAncestor)
      if (parent === existingAncestor) throw cause
      missingSegments.push(basename(existingAncestor))
      existingAncestor = parent
    }
  }
}

function contains(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
  return value as Record<string, unknown>
}

function nonEmptyString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`)
  }
  return value
}

function sha256(value: unknown, name: string): string {
  const digest = nonEmptyString(value, name)
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error(`${name} must be a lowercase SHA-256 digest`)
  }
  return digest
}

function samePaths(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((path, index) => path === [...right].sort()[index])
  )
}
