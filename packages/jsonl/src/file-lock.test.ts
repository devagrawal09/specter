import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'

import { createJsonlEventLog } from './event-log'
import { createJsonlReactionOutboxStore } from './reaction-outbox'

const packageDirectory = fileURLToPath(new URL('..', import.meta.url))
const fixture = fileURLToPath(
  new URL('./lock-child.fixture.ts', import.meta.url),
)
const directories: string[] = []
const children: ChildProcess[] = []
const closers: (() => void)[] = []

afterEach(() => {
  for (const close of closers.splice(0)) close()
  for (const child of children.splice(0)) child.kill('SIGKILL')
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'specter-jsonl-lock-'))
  directories.push(directory)
  return directory
}

function openEventLog(path: string) {
  const eventLog = createJsonlEventLog({ path })
  closers.push(eventLog.close)
  return eventLog
}

function openOutbox(path: string) {
  const outbox = createJsonlReactionOutboxStore({ path })
  closers.push(outbox.close)
  return outbox
}

/** The pid of a child that has exited and been reaped. */
function exitedPid() {
  const { pid } = spawnSync(process.execPath, ['-e', ''])
  if (pid === undefined) throw new Error('could not start a child process')
  return pid
}

function lockRecord(fields: {
  pid: number
  hostname?: string
  startedAt?: string
}) {
  return `${JSON.stringify({ hostname: hostname(), token: 'other-holder', ...fields })}\n`
}

function claimPath(lockPath: string, content: string) {
  return `${lockPath}.takeover-${createHash('sha256').update(content).digest('hex').slice(0, 16)}`
}

function leftovers(path: string) {
  return readdirSync(dirname(path)).filter((name) =>
    /\.(takeover|stale)-/.test(name),
  )
}

/** Starts the lock fixture; `next()` resolves with its next stdout record. */
function startChild(mode: 'hold' | 'race' | 'crash', target: string) {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', fixture, mode, target],
    { cwd: packageDirectory, stdio: ['pipe', 'pipe', 'inherit'] },
  )
  children.push(child)
  const received: Record<string, unknown>[] = []
  const waiting: ((message: Record<string, unknown>) => void)[] = []
  createInterface({ input: child.stdout as NodeJS.ReadableStream }).on(
    'line',
    (line) => {
      const message = JSON.parse(line) as Record<string, unknown>
      const waiter = waiting.shift()
      if (waiter) waiter(message)
      else received.push(message)
    },
  )
  const exited = once(child, 'exit')
  return {
    pid: child.pid as number,
    next: () =>
      new Promise<Record<string, unknown>>((resolve) => {
        const message = received.shift()
        if (message) resolve(message)
        else waiting.push(resolve)
      }),
    send: (line: string) => child.stdin?.write(`${line}\n`),
    /** Closes stdin, which closes what the child opened, and waits for it. */
    finish: async () => {
      child.stdin?.end()
      await exited
    },
    kill: async () => {
      child.kill('SIGKILL')
      await exited
    },
  }
}

describe('JSONL lock takeover', () => {
  it('takes over an Event Log lock left by an exited process', async () => {
    const path = join(temporaryDirectory(), 'events.jsonl')
    const first = createJsonlEventLog({ path })
    expect(first.recoveredStaleLock).toBeUndefined()
    await Effect.runPromise(first.append([{ type: 'todo-added', payload: {} }]))
    first.close()
    const pid = exitedPid()
    writeFileSync(`${path}.lock`, lockRecord({ pid }))

    const reopened = openEventLog(path)

    expect(reopened.recoveredStaleLock).toEqual({ pid, hostname: hostname() })
    expect(await Effect.runPromise(reopened.currentVersion)).toBe(1)
    expect(JSON.parse(readFileSync(`${path}.lock`, 'utf8'))).toMatchObject({
      pid: process.pid,
      hostname: hostname(),
    })
    expect(leftovers(path)).toEqual([])
    reopened.close()
    expect(readdirSync(dirname(path))).toEqual(['events.jsonl'])
  })

  it('takes over a Reaction outbox lock left by an exited process', async () => {
    const path = join(temporaryDirectory(), 'outbox.jsonl')
    const first = createJsonlReactionOutboxStore({ path })
    await Effect.runPromise(
      first.enqueue({
        id: 'job-1',
        idempotencyKey: 'job-1',
        payload: {},
        requestedAt: new Date(0),
        availableAt: new Date(0),
      }),
    )
    first.close()
    const pid = exitedPid()
    writeFileSync(`${path}.lock`, lockRecord({ pid }))

    const reopened = openOutbox(path)

    expect(reopened.recoveredStaleLock).toEqual({ pid, hostname: hostname() })
    expect(await Effect.runPromise(reopened.get('job-1'))).toMatchObject({
      status: 'pending',
    })
    expect(leftovers(path)).toEqual([])
  })

  it('takes over a legacy lock that holds only an exited pid', () => {
    const path = join(temporaryDirectory(), 'events.jsonl')
    const pid = exitedPid()
    writeFileSync(`${path}.lock`, `${pid}\n`)

    expect(openEventLog(path).recoveredStaleLock).toEqual({
      pid,
      hostname: undefined,
    })
  })

  it('takes over a lock naming this process when the path is not open here', () => {
    const path = join(temporaryDirectory(), 'events.jsonl')
    writeFileSync(`${path}.lock`, lockRecord({ pid: process.pid }))

    expect(openEventLog(path).recoveredStaleLock).toEqual({
      pid: process.pid,
      hostname: hostname(),
    })
    expect(() => createJsonlEventLog({ path })).toThrow(/already open/)
  })

  it.runIf(process.platform === 'linux')(
    'takes over a lock whose live pid started after the recorded holder',
    () => {
      const path = join(temporaryDirectory(), 'events.jsonl')
      writeFileSync(
        `${path}.lock`,
        lockRecord({ pid: process.ppid, startedAt: '1' }),
      )

      expect(openEventLog(path).recoveredStaleLock).toEqual({
        pid: process.ppid,
        hostname: hostname(),
      })
    },
  )

  it.each([
    ['a lock record', (pid: number) => lockRecord({ pid })],
    ['a legacy lock', (pid: number) => `${pid}\n`],
  ])('refuses %s held by a live process', (_name, content) => {
    const path = join(temporaryDirectory(), 'events.jsonl')
    writeFileSync(`${path}.lock`, content(process.ppid))

    expect(() => createJsonlEventLog({ path })).toThrow(
      `is locked by ${path}.lock: held by live process ${process.ppid}.`,
    )
    expect(readFileSync(`${path}.lock`, 'utf8')).toBe(content(process.ppid))
  })

  it('refuses a lock written on another host, even for a pid exited here', () => {
    const path = join(temporaryDirectory(), 'outbox.jsonl')
    const content = lockRecord({
      pid: exitedPid(),
      hostname: 'elsewhere.example',
    })
    writeFileSync(`${path}.lock`, content)

    expect(() => createJsonlReactionOutboxStore({ path })).toThrow(
      /held by process \d+ on host elsewhere\.example/,
    )
    expect(readFileSync(`${path}.lock`, 'utf8')).toBe(content)
  })

  it.each([
    ['an empty file', ''],
    ['text', 'not a lock\n'],
    ['pid 0', '0\n'],
    ['a negative pid', '-1\n'],
    ['a record without a token', '{"pid":1,"hostname":"h"}\n'],
    ['a JSON array', '[1]\n'],
  ])('refuses a lock file holding %s', (_name, content) => {
    const path = join(temporaryDirectory(), 'events.jsonl')
    writeFileSync(`${path}.lock`, content)

    expect(() => createJsonlEventLog({ path })).toThrow(
      'its content is not a lock record',
    )
    expect(readFileSync(`${path}.lock`, 'utf8')).toBe(content)
  })

  it('recovers a takeover claim left by a process that exited mid-takeover', () => {
    const path = join(temporaryDirectory(), 'events.jsonl')
    const content = lockRecord({ pid: exitedPid() })
    writeFileSync(`${path}.lock`, content)
    writeFileSync(
      claimPath(`${path}.lock`, content),
      lockRecord({ pid: exitedPid() }),
    )

    expect(openEventLog(path).recoveredStaleLock).toBeDefined()
    expect(leftovers(path)).toEqual([])
  })

  it('waits out a takeover claim held by a live process, then fails', () => {
    const path = join(temporaryDirectory(), 'events.jsonl')
    const content = lockRecord({ pid: exitedPid() })
    const claim = claimPath(`${path}.lock`, content)
    writeFileSync(`${path}.lock`, content)
    writeFileSync(claim, lockRecord({ pid: process.ppid }))

    expect(() => createJsonlEventLog({ path })).toThrow(/takeover-\*/)
    expect(readFileSync(`${path}.lock`, 'utf8')).toBe(content)
    expect(readFileSync(claim, 'utf8')).toBe(lockRecord({ pid: process.ppid }))
  })

  it('leaves a lock in place on close once another holder has taken it', () => {
    const path = join(temporaryDirectory(), 'events.jsonl')
    const eventLog = createJsonlEventLog({ path })
    const newHolder = lockRecord({ pid: process.ppid })
    writeFileSync(`${path}.lock`, newHolder)

    eventLog.close()

    expect(readFileSync(`${path}.lock`, 'utf8')).toBe(newHolder)
  })
})

describe('JSONL lock takeover across processes', () => {
  it('refuses a live holder, then takes over once it is killed', async () => {
    const path = join(temporaryDirectory(), 'events.jsonl')
    const holder = startChild('hold', path)
    expect(await holder.next()).toEqual({ ready: true })

    expect(() => createJsonlEventLog({ path })).toThrow(
      `held by live process ${holder.pid}.`,
    )
    await holder.kill()

    expect(openEventLog(path).recoveredStaleLock).toEqual({
      pid: holder.pid,
      hostname: hostname(),
    })
  }, 30_000)

  it('lets exactly one of several racing processes take over', async () => {
    for (let round = 0; round < 3; round++) {
      const path = join(temporaryDirectory(), 'events.jsonl')
      const stalePid = exitedPid()
      writeFileSync(`${path}.lock`, lockRecord({ pid: stalePid }))
      const racers = Array.from({ length: 4 }, () => startChild('race', path))
      for (const racer of racers) {
        expect(await racer.next()).toEqual({ ready: true })
      }
      for (const racer of racers) racer.send('go')
      const outcomes = await Promise.all(racers.map((racer) => racer.next()))

      const winners = racers.filter((_racer, index) => outcomes[index].ok)
      expect(winners).toHaveLength(1)
      const [winner] = winners
      for (const outcome of outcomes) {
        if (outcome.ok) {
          // The racer that removed the stale lock can lose the create that
          // follows to a racer that found the path free.
          expect([
            undefined,
            { pid: stalePid, hostname: hostname() },
          ]).toContainEqual(outcome.recoveredStaleLock)
        } else {
          expect(outcome.error).toContain(`held by live process ${winner.pid}.`)
        }
      }
      expect(JSON.parse(readFileSync(`${path}.lock`, 'utf8')).pid).toBe(
        winner.pid,
      )
      expect(leftovers(path)).toEqual([])
      await Promise.all(racers.map((racer) => racer.finish()))
      expect(readdirSync(dirname(path))).toEqual(['events.jsonl'])
    }
  }, 60_000)

  it('reopens an Event Log and outbox after their process is killed', async () => {
    const directory = temporaryDirectory()
    const crashed = startChild('crash', directory)
    expect(await crashed.next()).toEqual({ ready: true })
    await crashed.kill()

    const eventLog = openEventLog(join(directory, 'events.jsonl'))
    const outbox = openOutbox(join(directory, 'outbox.jsonl'))

    const recovered = { pid: crashed.pid, hostname: hostname() }
    expect(eventLog.recoveredStaleLock).toEqual(recovered)
    expect(outbox.recoveredStaleLock).toEqual(recovered)
    expect(
      (await Effect.runPromise(eventLog.commitsAfter(0))).map((commit) =>
        commit.events.map((event) => event.type),
      ),
    ).toEqual([['turn-started'], ['turn-finished']])
    expect(outbox.releasedOnOpen).toEqual(['job-1'])
    expect(await Effect.runPromise(outbox.get('job-1'))).toMatchObject({
      status: 'pending',
      attemptCount: 1,
    })
  }, 30_000)
})
