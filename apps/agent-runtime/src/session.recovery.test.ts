import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

import type { JsonlEventLog } from '@specter-ts/jsonl'
import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'

import { openJsonlSessionApp } from './app.jsonl.ts'
import { makeScriptedModel } from './plugins/scripted-model.ts'

// Crash and restart over the JSONL composition. "App A" is a real child
// process killed with SIGKILL: the JSONL Event Log and outbox refuse a second
// open of a file inside one process, and an in-process "abandon" would keep
// the first app's lock and worker alive, so only a dead process exercises
// lock takeover and the outbox's resume of the attempt it left running.
const root = new URL('..', import.meta.url).pathname

const directories: string[] = []
const children: ChildProcess[] = []
const running: { close: () => Promise<void> }[] = []

afterEach(async () => {
  for (const app of running.splice(0)) await app.close()
  for (const child of children.splice(0)) child.kill('SIGKILL')
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

// Starts app A in a child process and resolves once its step is in flight.
const startAppA = async (directory: string, mode = 'step') => {
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      '--import',
      './src/single-effect.mjs',
      'src/recovery.child.ts',
      directory,
      mode,
    ],
    {
      cwd: root,
      // tsx would otherwise apply the app tsconfig's type-only `paths`.
      env: { ...process.env, TSX_TSCONFIG_PATH: '/dev/null' },
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  )
  children.push(child)
  const exited = new Promise<void>((resolve) =>
    child.once('exit', () => resolve()),
  )
  const { stdout, pid } = child
  if (!stdout || pid === undefined) throw new Error('app A did not start')
  await new Promise<void>((resolve, reject) => {
    const lines = createInterface({ input: stdout })
    lines.on('line', (line) => line === 'in-flight' && resolve())
    child.once('exit', (code) =>
      reject(new Error(`app A exited early with ${code}`)),
    )
  })
  // Unclean death: no shutdown path, no lease release, locks left behind.
  const kill = async () => {
    child.kill('SIGKILL')
    await exited
  }
  return { pid, kill }
}

const events = (log: JsonlEventLog) =>
  Effect.runSync(log.commitsAfter(0)).flatMap((commit) => commit.events)

const waitFor = async (
  condition: () => boolean,
  describeState: () => string,
) => {
  const deadline = Date.now() + 5000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out; ${describeState()}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('crash and restart (JSONL)', { timeout: 30_000 }, () => {
  it('resumes a step that was in flight when its process died, as a new attempt of the same step', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-runtime-recovery-'))
    directories.push(directory)

    const a = await startAppA(directory)
    await a.kill()

    // App B: same directory, a model that completes.
    const model = makeScriptedModel()
    model.script('ses_1', [{ finish: 'stop', text: 'done' }])
    const b = await openJsonlSessionApp({ directory, model })
    running.push(b)
    const types = () => events(b.log).map((event) => event.type)
    await waitFor(
      () => types().includes('session-execution-settled'),
      () => `events: ${types().join(', ')}`,
    )

    // Opening took over A's locks and released the attempt A left running.
    expect(b.log.recoveredStaleLock?.pid).toBe(a.pid)
    expect(b.outbox.recoveredStaleLock?.pid).toBe(a.pid)
    expect(b.outbox.releasedOnOpen).toEqual(['runStep:3'])

    expect(types()).toEqual([
      'session-created',
      'session-inbox-enqueued',
      'session-execution-started',
      'session-inbox-delivered',
      'session-step-started', // A
      'session-step-settled', // orphan reconciliation
      'session-step-started', // B: a new physical attempt
      'session-text-started', // the scripted text is now durable
      'session-text-ended',
      'session-step-settled',
      'session-execution-settled',
    ])
    const of = (type: string) =>
      events(b.log)
        .filter((event) => event.type === type)
        .map((event) => event.payload as Record<string, unknown>)
    const starts = of('session-step-started')
    expect(starts).toHaveLength(2)
    expect(starts[1]?.assistantMessageID).toBe(starts[0]?.assistantMessageID)
    expect(of('session-step-settled')[0]).toMatchObject({
      assistantMessageID: starts[0]?.assistantMessageID,
      outcome: 'failed',
      error: { type: 'orphaned' },
      retry: { attempt: 1 },
    })
    // One execution, and the inbox item was delivered exactly once.
    expect(of('session-execution-started')).toHaveLength(1)
    expect(of('session-inbox-delivered').map((p) => p.inboxID)).toEqual([
      'msg_a',
    ])
    expect(
      await b.app.query({
        type: 'executionStatus',
        payload: { sessionID: 'ses_1' },
      }),
    ).toEqual({ status: 'settled', executions: 1, lastOutcome: 'succeeded' })
    expect(
      await b.app.query({
        type: 'stepStatus',
        payload: { sessionID: 'ses_1' },
      }),
    ).toEqual({
      active: false,
      stepInFlight: false,
      stepsStarted: 1,
      attempts: 2,
    })

    // Every job settles; nothing is dead-lettered.
    await waitFor(
      () =>
        Effect.runSync(b.outbox.list()).every(
          (job) => job.status === 'completed',
        ),
      () => JSON.stringify(Effect.runSync(b.outbox.list())),
    )

    // A second restart finds nothing to resume.
    const count = events(b.log).length
    await b.close()
    running.pop()
    const c = await openJsonlSessionApp({
      directory,
      model: makeScriptedModel(),
    })
    running.push(c)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(events(c.log)).toHaveLength(count)
    expect(c.outbox.releasedOnOpen).toEqual([])
  })

  it('settles a tool call that was running when its process died as aborted, before failing the step, and the retry sees the result', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-runtime-recovery-'))
    directories.push(directory)

    const a = await startAppA(directory, 'tool')
    await a.kill()

    // App B: records what the retried attempt sends the provider.
    const scripted = makeScriptedModel()
    scripted.script('ses_1', [{ finish: 'stop', text: 'done' }])
    const sent: unknown[] = []
    const model = {
      ...scripted,
      nextOutcome: (input: Parameters<typeof scripted.nextOutcome>[0]) => {
        sent.push(input.messages)
        return scripted.nextOutcome(input)
      },
    }
    const b = await openJsonlSessionApp({ directory, model })
    running.push(b)
    const types = () => events(b.log).map((event) => event.type)
    await waitFor(
      () => types().includes('session-execution-settled'),
      () => `events: ${types().join(', ')}`,
    )

    expect(types()).toEqual([
      'session-created',
      'session-inbox-enqueued',
      'session-execution-started',
      'session-inbox-delivered',
      'session-step-started', // A
      'session-tool-input-started',
      'session-tool-input-ended',
      'session-tool-called', // A died here: the call is running
      'session-tool-failed', // reconciliation settles the call first
      'session-step-settled',
      'session-step-started', // B: a new physical attempt
      'session-text-started',
      'session-text-ended',
      'session-step-settled',
      'session-execution-settled',
    ])
    const of = (type: string) =>
      events(b.log)
        .filter((event) => event.type === type)
        .map((event) => event.payload as Record<string, unknown>)
    expect(of('session-tool-failed')).toEqual([
      expect.objectContaining({
        id: 'call_1',
        error: {
          type: 'aborted',
          message: 'Tool execution interrupted: execute',
        },
        executed: false,
      }),
    ])
    expect(of('session-step-settled')[0]).toMatchObject({
      outcome: 'failed',
      error: { type: 'orphaned' },
    })

    // The retried attempt sent the call together with its aborted result.
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual([
      expect.objectContaining({ role: 'user' }),
      expect.objectContaining({
        role: 'assistant',
        content: [expect.objectContaining({ type: 'tool-call', id: 'call_1' })],
      }),
      {
        role: 'tool',
        content: [
          expect.objectContaining({
            type: 'tool-result',
            id: 'call_1',
            result: {
              type: 'error',
              value: {
                error: {
                  type: 'aborted',
                  message: 'Tool execution interrupted: execute',
                },
                content: [],
              },
            },
          }),
        ],
      },
    ])
  })

  it('fails the execution when orphaned attempts exhaust the retry budget', async () => {
    // A step that dies on every attempt: app B is also killed mid-step, twice
    // more, so reconciliation fails it three times and the fourth open
    // settles the execution instead of retrying again.
    const directory = mkdtempSync(join(tmpdir(), 'agent-runtime-recovery-'))
    directories.push(directory)

    const first = await startAppA(directory)
    await first.kill()
    for (let restart = 0; restart < 3; restart++) {
      // Each restart reconciles and re-attempts; the child blocks again.
      const next = await startAppA(directory)
      await next.kill()
    }

    const b = await openJsonlSessionApp({
      directory,
      model: makeScriptedModel(),
    })
    running.push(b)
    const types = () => events(b.log).map((event) => event.type)
    await waitFor(
      () => types().includes('session-execution-settled'),
      () => `events: ${types().join(', ')}`,
    )
    expect(
      events(b.log).filter(
        (event) =>
          event.type === 'session-step-settled' &&
          (event.payload as { retry?: unknown }).retry !== undefined,
      ),
    ).toHaveLength(3)
    expect(
      events(b.log).find((event) => event.type === 'session-execution-settled')
        ?.payload,
    ).toMatchObject({ outcome: 'failed', error: { type: 'orphaned' } })
  })
})
