import { readdirSync, statSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'

export function existingSegmentPaths(databaseBase: string) {
  const directory = dirname(databaseBase)
  const prefix = `${basename(databaseBase)}-`
  return readdirSync(directory)
    .filter(
      (name) =>
        name.startsWith(prefix) &&
        name.endsWith('.db') &&
        /^\d+$/.test(name.slice(prefix.length, -'.db'.length)),
    )
    .sort()
    .map((name) => resolve(directory, name))
}

/**
 * Measures durable SQLite storage. The WAL and rollback journal hold database
 * pages that have not necessarily reached the main file yet; the SHM file is
 * an index over the WAL rather than durable application data.
 */
export function sqliteDatabaseSize(path: string) {
  return [path, `${path}-wal`, `${path}-journal`].reduce(
    (total, candidate) => total + fileSize(candidate),
    0,
  )
}

function fileSize(path: string) {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}
