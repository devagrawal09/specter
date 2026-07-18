import { createHash } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve, sep } from 'node:path'

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

export function writeJsonAtomic(path: string, value: unknown): void {
  const temporaryPath = `${path}.tmp-${process.pid}`
  if (existsSync(temporaryPath)) {
    throw new Error(`Refusing to overwrite temporary file: ${temporaryPath}`)
  }
  writeFileSync(temporaryPath, `${stableJson(value)}\n`, { flag: 'wx' })
  renameSync(temporaryPath, path)
}

export function appendJsonLine(path: string, value: unknown): void {
  appendFileSync(path, `${JSON.stringify(sortValue(value))}\n`, {
    encoding: 'utf8',
  })
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value), null, 2)
}

export function resolveBelow(root: string, relativePath: string): string {
  const absoluteRoot = resolve(root)
  const result = resolve(absoluteRoot, relativePath)
  if (result !== absoluteRoot && !result.startsWith(`${absoluteRoot}${sep}`)) {
    throw new Error(`Path escapes configured root: ${relativePath}`)
  }
  return result
}

export function assertParent(path: string, expectedParent: string): void {
  if (dirname(path) !== resolve(expectedParent)) {
    throw new Error(`Path is not an immediate child of ${expectedParent}`)
  }
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortValue(entry)]),
    )
  }
  return value
}
