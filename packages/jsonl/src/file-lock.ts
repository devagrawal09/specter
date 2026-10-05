import { closeSync, mkdirSync, openSync, rmSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'

/** Absolute paths of JSONL files open for writing in this process. */
const openPaths = new Set<string>()

/**
 * Makes the caller the only writer of `path`: creates `<path>.lock`
 * exclusively, holding this process id, and returns a function that removes
 * it. A lock file left by a crashed process is reported, never taken over.
 */
export function acquireLock(path: string, label: string) {
  if (openPaths.has(path)) {
    throw new Error(`${label} ${path} is already open in this process`)
  }
  mkdirSync(dirname(path), { recursive: true })
  const lockPath = `${path}.lock`
  let fd: number
  try {
    fd = openSync(lockPath, 'wx')
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(
        `${label} ${path} is locked by ${lockPath}. Another process has the file open, or a crashed process left the lock file behind; delete it only after confirming no process uses the file.`,
        { cause },
      )
    }
    throw cause
  }
  try {
    writeAll(fd, Buffer.from(`${process.pid}\n`))
  } finally {
    closeSync(fd)
  }
  openPaths.add(path)
  return () => {
    openPaths.delete(path)
    rmSync(lockPath, { force: true })
  }
}

export function closeQuietly(fd: number) {
  try {
    closeSync(fd)
  } catch {
    // The original failure is the one to report.
  }
}

export function writeAll(fd: number, buffer: Buffer) {
  let offset = 0
  while (offset < buffer.length) {
    offset += writeSync(fd, buffer, offset)
  }
}
