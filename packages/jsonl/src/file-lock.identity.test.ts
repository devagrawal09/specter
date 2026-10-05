import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { acquireLock } from './file-lock'

/** Paths `file-lock.ts` reads or links through `node:fs`, and its hostname calls. */
const calls = vi.hoisted(() => ({ paths: [] as string[], hostname: 0 }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    readFileSync: ((...args: Parameters<typeof actual.readFileSync>) => {
      calls.paths.push(String(args[0]))
      return actual.readFileSync(...args)
    }) as typeof actual.readFileSync,
    readlinkSync: ((...args: Parameters<typeof actual.readlinkSync>) => {
      calls.paths.push(String(args[0]))
      return actual.readlinkSync(...args)
    }) as typeof actual.readlinkSync,
  }
})

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return {
    ...actual,
    hostname: () => {
      calls.hostname++
      return actual.hostname()
    },
  }
})

const linux = process.platform === 'linux'
const identityKey = Symbol.for('@specter-ts/jsonl/process-identity')
const directories: string[] = []
const children: ChildProcess[] = []

beforeEach(() => {
  delete (globalThis as Record<symbol, unknown>)[identityKey]
  calls.paths.length = 0
  calls.hostname = 0
})

afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGKILL')
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'specter-jsonl-identity-'))
  directories.push(directory)
  return directory
}

function count(path: string) {
  return calls.paths.filter((read) => read === path).length
}

const ownReads = [
  `/proc/${process.pid}/stat`,
  '/proc/self/ns/pid',
  '/proc/sys/kernel/random/boot_id',
]

describe('JSONL lock process identity', () => {
  it('reads this process identity once across acquires', () => {
    const directory = temporaryDirectory()
    for (let index = 0; index < 5; index++) {
      acquireLock(join(directory, `log-${index}.jsonl`), 'test').release()
    }
    const path = join(directory, 'again.jsonl')
    for (let index = 0; index < 5; index++) {
      acquireLock(path, 'test').release()
    }

    expect(calls.hostname).toBe(1)
    for (const read of ownReads) expect(count(read)).toBe(linux ? 1 : 0)
  })

  it.skipIf(!linux)(
    'reads a foreign holder on every check, but this process once',
    () => {
      const holder = spawn(process.execPath, [
        '-e',
        'setInterval(() => {}, 1000)',
      ])
      children.push(holder)
      const pid = holder.pid as number
      const path = join(temporaryDirectory(), 'events.jsonl')
      writeFileSync(
        `${path}.lock`,
        `${JSON.stringify({ pid, hostname: hostname(), token: 'other-holder' })}\n`,
      )
      calls.hostname = 0

      for (let attempt = 0; attempt < 3; attempt++) {
        expect(() => acquireLock(path, 'test')).toThrow(
          `held by live process ${pid}`,
        )
      }

      expect(count(`/proc/${pid}/stat`)).toBe(3)
      expect(calls.hostname).toBe(1)
      for (const read of ownReads) expect(count(read)).toBe(1)
    },
  )
})
