/**
 * Child process for the lock tests. Lines on stdout report progress; closing
 * stdin closes what the child opened and ends it.
 *
 * - `hold <path>`: opens an Event Log and keeps it open.
 * - `race <path>`: waits for a line on stdin, then tries to open an Event Log
 *   and reports the outcome; a winner keeps the log open.
 * - `crash <directory>`: opens an Event Log and a Reaction outbox, commits
 *   Events, claims a job, and waits to be killed.
 */
import { createInterface } from 'node:readline'
import { join } from 'node:path'

import { Effect } from 'effect'

import { createJsonlEventLog } from './event-log'
import { createJsonlReactionOutboxStore } from './reaction-outbox'

const [mode, target] = process.argv.slice(2)
const closers: (() => void)[] = []
const lines = createInterface({ input: process.stdin })

function report(message: unknown) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

lines.on('close', () => {
  for (const close of closers) close()
  process.exit(0)
})

if (mode === 'hold') {
  closers.push(createJsonlEventLog({ path: target }).close)
  report({ ready: true })
} else if (mode === 'race') {
  lines.once('line', () => {
    try {
      const eventLog = createJsonlEventLog({ path: target })
      closers.push(eventLog.close)
      report({ ok: true, recoveredStaleLock: eventLog.recoveredStaleLock })
    } catch (cause) {
      report({ ok: false, error: (cause as Error).message })
    }
  })
  report({ ready: true })
} else if (mode === 'crash') {
  const eventLog = createJsonlEventLog({ path: join(target, 'events.jsonl') })
  const outbox = createJsonlReactionOutboxStore({
    path: join(target, 'outbox.jsonl'),
  })
  await Effect.runPromise(
    Effect.gen(function* () {
      yield* eventLog.append([{ type: 'turn-started', payload: { turn: 1 } }])
      yield* eventLog.append([{ type: 'turn-finished', payload: { turn: 1 } }])
      yield* outbox.enqueue({
        id: 'job-1',
        idempotencyKey: 'job-1',
        payload: { turn: 1 },
        requestedAt: new Date(0),
        availableAt: new Date(0),
      })
      yield* outbox.claimNext(new Date(0), new Date(60 * 60 * 1_000))
    }),
  )
  report({ ready: true })
} else {
  throw new Error(`Unknown mode ${mode}`)
}
