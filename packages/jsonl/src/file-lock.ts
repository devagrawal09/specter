import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { hostname } from 'node:os'
import { basename, dirname, join } from 'node:path'

/** The process a stale lock file named, reported after taking it over. */
export type JsonlStaleLock = {
  readonly pid: number
  /** `undefined` for a lock file written before locks recorded the host. */
  readonly hostname: string | undefined
}

/** What a lock file says about its holder. */
type LockRecord = JsonlStaleLock & {
  /** Start time from `/proc/<pid>/stat`, compared only for equality. */
  readonly startedAt?: string
  /** `/proc/self/ns/pid` of the holder (Linux). */
  readonly pidNamespace?: string
  /** `/proc/sys/kernel/random/boot_id` when the holder ran (Linux). */
  readonly bootId?: string
  readonly token?: string
}

/**
 * Labels of the JSONL files open for writing in this process, keyed by the
 * real path of their directory plus their name, so a symlinked alias of an
 * open file is refused here. Kept on `globalThis` so every copy of this
 * package in the thread shares it.
 */
const registry = globalThis as {
  [key: symbol]: Map<string, string> | ProcessIdentity | undefined
}
const openPathsKey = Symbol.for('@specter-ts/jsonl/open-paths')
registry[openPathsKey] ??= new Map()
const openPaths = registry[openPathsKey] as Map<string, string>

/**
 * This process's host, start time, pid namespace, and boot, which cannot
 * change while it runs. Read on the first lock and kept on `globalThis`, so
 * every copy of this package in the thread reads them once.
 */
type ProcessIdentity = {
  readonly hostname: string
  readonly startedAt?: string
  readonly pidNamespace?: string
  readonly bootId?: string
}
const processIdentityKey = Symbol.for('@specter-ts/jsonl/process-identity')

const maxAttempts = 5
const retryDelayMs = 20
const unreadable = 'its content is not a lock record'

/**
 * Makes the caller the only writer of `path`: creates `<path>.lock`
 * exclusively, holding a record of this process, and returns `release`, which
 * removes it while it still holds this record. An existing lock file is taken
 * over, and its holder returned as `recoveredStaleLock`, only when the holder
 * ran on this host and has exited; otherwise the open fails and says why.
 */
export function acquireLock(path: string, label: string) {
  mkdirSync(dirname(path), { recursive: true })
  // The file may not exist yet, so resolve its directory.
  const key = join(realpathSync.native(dirname(path)), basename(path))
  const holder = openPaths.get(key)
  if (holder) {
    throw new Error(
      `${label} ${path} is already open in this process as a ${holder}`,
    )
  }
  const lockPath = `${path}.lock`
  const own = ownRecord()
  const content = `${JSON.stringify(own)}\n`
  let recoveredStaleLock: JsonlStaleLock | undefined
  for (let attempt = 1; ; attempt++) {
    if (createExclusive(lockPath, content)) break
    if (attempt > maxAttempts) {
      throw new Error(
        `${label} ${path} is locked by ${lockPath}, which kept changing while this process tried to take it over, or a claim file ${lockPath}.takeover-* is held by another process. Retry the open; delete a claim file only after confirming no process is opening the file.`,
      )
    }
    const existing = readIfExists(lockPath)
    if (existing === undefined) continue
    const stale = staleHolder(existing)
    // A lock file is empty until its creator writes the record.
    if (stale === unreadable && attempt < maxAttempts) {
      sleep(retryDelayMs)
      continue
    }
    if (typeof stale === 'string') {
      throw new Error(
        `${label} ${path} is locked by ${lockPath}: ${stale}. A lock is taken over only when its process ran on this host, in this pid namespace, and has exited; delete the lock file only after confirming no process uses the file.`,
      )
    }
    if (removeStale(lockPath, existing, 0)) {
      recoveredStaleLock = { pid: stale.pid, hostname: stale.hostname }
    } else {
      sleep(retryDelayMs)
    }
  }
  openPaths.set(key, label)
  return {
    recoveredStaleLock,
    release: () => {
      openPaths.delete(key)
      // A lock taken over from this process belongs to its new holder.
      const current = readIfExists(lockPath)
      if (current !== undefined && parseLock(current)?.token === own.token) {
        rmSync(lockPath, { force: true })
      }
    },
  }
}

/**
 * Removes `target` if it still holds `content`. Only the creator of the claim
 * file named after `content` may remove it, so concurrent openers that judged
 * the same file stale cannot remove a newer lock: the claimer reads `target`
 * again while holding the claim, and a newer lock no longer matches. A claim
 * left by a process that died mid-takeover is removed the same way, once.
 */
function removeStale(target: string, content: string, depth: number) {
  const claimPath = `${target}.takeover-${createHash('sha256').update(content).digest('hex').slice(0, 16)}`
  const claim = `${JSON.stringify(ownRecord())}\n`
  if (!createExclusive(claimPath, claim)) {
    const existing = readIfExists(claimPath)
    if (
      existing !== undefined &&
      depth === 0 &&
      typeof staleHolder(existing) !== 'string'
    ) {
      removeStale(claimPath, existing, depth + 1)
    }
    return false
  }
  try {
    if (readIfExists(target) !== content) return false
    unlinkSync(target)
    return true
  } finally {
    rmSync(claimPath, { force: true })
  }
}

/**
 * Returns the holder named by `content` if it is provably gone, or why the
 * lock must be kept.
 */
function staleHolder(content: string): LockRecord | string {
  const record = parseLock(content)
  if (!record) return unreadable
  const own = processIdentity()
  if (record.hostname !== undefined && record.hostname !== own.hostname) {
    return `held by process ${record.pid} on host ${record.hostname}`
  }
  // Every process of an earlier boot of this host has exited.
  if (record.bootId && own.bootId && record.bootId !== own.bootId) {
    return record
  }
  if (
    record.pidNamespace &&
    own.pidNamespace &&
    record.pidNamespace !== own.pidNamespace
  ) {
    return `held by process ${record.pid} in pid namespace ${record.pidNamespace}, not this process's ${own.pidNamespace}`
  }
  if (record.pid === process.pid) {
    // Only a recorded start time other than ours shows that an earlier
    // process with this pid wrote it; otherwise another open in this process
    // (a worker thread, or a path alias) may hold it.
    if (
      record.startedAt &&
      own.startedAt &&
      record.startedAt !== own.startedAt
    ) {
      return record
    }
    return `held by this process (${record.pid}), through another path to the file or from another thread`
  }
  // Another process's state and start time are read on every check.
  const holder = processStat(record.pid)
  if (!isAlive(record.pid) || holder?.state === 'Z') return record
  if (record.startedAt && holder && record.startedAt !== holder.startedAt) {
    return record
  }
  return `held by live process ${record.pid}`
}

function parseLock(content: string): LockRecord | undefined {
  const text = content.trim()
  if (/^\d+$/.test(text)) {
    // Written before locks recorded more than the pid; read as this host's.
    return validPid(Number(text))
      ? { pid: Number(text), hostname: undefined }
      : undefined
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (
    !validPid(record.pid) ||
    typeof record.hostname !== 'string' ||
    typeof record.token !== 'string' ||
    !optionalString(record.startedAt) ||
    !optionalString(record.pidNamespace) ||
    !optionalString(record.bootId)
  ) {
    return undefined
  }
  return {
    pid: record.pid,
    hostname: record.hostname,
    startedAt: record.startedAt,
    pidNamespace: record.pidNamespace,
    bootId: record.bootId,
    token: record.token,
  }
}

function validPid(pid: unknown): pid is number {
  return Number.isSafeInteger(pid) && (pid as number) > 0
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function ownRecord() {
  return { pid: process.pid, ...processIdentity(), token: randomUUID() }
}

function processIdentity() {
  registry[processIdentityKey] ??= readProcessIdentity()
  return registry[processIdentityKey] as ProcessIdentity
}

/** Linux fields are left out where `/proc` is missing or unreadable. */
function readProcessIdentity(): ProcessIdentity {
  if (process.platform !== 'linux') return { hostname: hostname() }
  const read = (source: () => string) => {
    try {
      return source().trim() || undefined
    } catch {
      return undefined
    }
  }
  return {
    hostname: hostname(),
    startedAt: processStat(process.pid)?.startedAt,
    pidNamespace: read(() => readlinkSync('/proc/self/ns/pid')),
    bootId: read(() => readFileSync('/proc/sys/kernel/random/boot_id', 'utf8')),
  }
}

/** `EPERM` means the process exists but belongs to another user. */
function isAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

/**
 * Fields 3 (state; `Z` is an exited, unreaped process) and 22 (start time in
 * clock ticks since boot, which tells a reused pid apart from the recorded
 * process) of `/proc/<pid>/stat`. `undefined` where `/proc` is not available.
 */
function processStat(pid: number) {
  if (process.platform !== 'linux') return undefined
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    // The command name in field 2 may contain spaces and parentheses.
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    return { state: fields[0], startedAt: fields[19] || undefined }
  } catch {
    return undefined
  }
}

function createExclusive(path: string, content: string) {
  let fd: number
  try {
    fd = openSync(path, 'wx')
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw cause
  }
  try {
    writeAll(fd, Buffer.from(content))
  } catch (cause) {
    closeQuietly(fd)
    rmSync(path, { force: true })
    throw cause
  }
  closeSync(fd)
  return true
}

function readIfExists(path: string) {
  try {
    return readFileSync(path, 'utf8')
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw cause
  }
}

function sleep(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
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
