import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

export type JsonSliceSnapshot = {
  lastAppliedOrder: number
  state: Record<string, unknown>
}

export type JsonSliceStorage = {
  read: (sliceName: string) => JsonSliceSnapshot | undefined
  write: (sliceName: string, snapshot: JsonSliceSnapshot) => void
}

export function createMemoryJsonSliceStorage(): JsonSliceStorage {
  const snapshots = new Map<string, JsonSliceSnapshot>()

  return {
    read: (sliceName) => cloneSnapshot(snapshots.get(sliceName)),
    write: (sliceName, snapshot) => {
      snapshots.set(sliceName, cloneSnapshot(snapshot) ?? emptySnapshot())
    },
  }
}

export function createFileJsonSliceStorage(
  directory: string,
): JsonSliceStorage {
  let temporaryFileCounter = 0

  return {
    read: (sliceName) => {
      const filePath = jsonSliceStatePath(directory, sliceName)

      if (!existsSync(filePath)) {
        return undefined
      }

      return parseSnapshot(readFileSync(filePath, 'utf8'))
    },
    write: (sliceName, snapshot) => {
      const filePath = jsonSliceStatePath(directory, sliceName)
      mkdirSync(dirname(filePath), { recursive: true })

      temporaryFileCounter += 1

      const temporaryFilePath = `${filePath}.${process.pid}.${Date.now()}.${temporaryFileCounter}.tmp`
      writeFileSync(temporaryFilePath, `${JSON.stringify(snapshot, null, 2)}\n`)
      renameSync(temporaryFilePath, filePath)
    },
  }
}

export function emptySnapshot(): JsonSliceSnapshot {
  return { lastAppliedOrder: 0, state: {} }
}

function parseSnapshot(value: string): JsonSliceSnapshot | undefined {
  try {
    const parsed = JSON.parse(value)

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.lastAppliedOrder !== 'number' ||
      typeof parsed.state !== 'object' ||
      parsed.state === null ||
      Array.isArray(parsed.state)
    ) {
      return undefined
    }

    return {
      lastAppliedOrder: parsed.lastAppliedOrder,
      state: parsed.state,
    }
  } catch {
    return undefined
  }
}

function cloneSnapshot(snapshot: JsonSliceSnapshot | undefined) {
  if (!snapshot) {
    return undefined
  }

  return structuredClone(snapshot)
}

function jsonSliceStatePath(directory: string, sliceName: string) {
  return join(directory, `${safeJsonSliceStateName(sliceName)}.json`)
}

function safeJsonSliceStateName(sliceName: string) {
  return sliceName.replaceAll(/[^a-zA-Z0-9_-]/g, '_')
}
