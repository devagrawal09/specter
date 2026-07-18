import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'

export interface AdopterIsolationContract {
  readonly schemaVersion: 1
  readonly coordinatorRoot: string
  readonly adopterRoot: string
  readonly publicCanaryPaths: readonly string[]
  readonly privateCanaryPaths: readonly string[]
}

export interface IsolationRehearsalResult {
  readonly passed: boolean
  readonly publicReadable: readonly string[]
  readonly privateBlocked: readonly string[]
  readonly failures: readonly string[]
}

/** Run from inside the actual adopter sandbox/container. */
export function rehearseAdopterAccessIsolation(
  value: unknown,
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
  const coordinatorRoot = directory(input.coordinatorRoot, 'coordinatorRoot')
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
    coordinatorRoot,
    adopterRoot,
    publicCanaryPaths,
    privateCanaryPaths,
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
  return value.map((entry, index) => absolute(entry, `${name}[${index}]`))
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
