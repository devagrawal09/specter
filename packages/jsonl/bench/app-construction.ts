// Measures what one Specter app per session costs to construct, run, and
// close. Not a test. Run with `pnpm --filter @specter-ts/jsonl bench` after
// building @specter-ts/spec, @specter-ts/core, and @specter-ts/memory.
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

import { createSpecterApp, type SpecterApp } from '@specter-ts/core'
import { createSpecterAppLayer } from '@specter-ts/core/effect'
import {
  createImmediateReactionSchedulerLayer,
  createMemorySliceStoreLayer,
} from '@specter-ts/memory'
import { Effect, Exit, Layer, ManagedRuntime, Scope } from 'effect'

// Source import: the conformance pass is not a public export, so `bench/` is
// left out of the package typecheck; tsx runs it without type checking.
import { collectConformanceDiagnostics } from '../../core/src/definition/conformance.ts'
import {
  createJsonlEventLogLayer,
  createJsonlSliceStoreLayer,
} from '../src/index'
import {
  createSessionState,
  sessionAppConfig,
  SessionStore,
} from './session-app'

type SessionApp = SpecterApp<typeof sessionAppConfig>

const count = Number(process.env.APPS ?? 500)
// STORE=memory replays every Slice and Reaction from the log on reopen;
// STORE=jsonl (default) keeps each Slice's state and cursor in a JSON file.
const store = process.env.STORE === 'memory' ? 'memory' : 'jsonl'
const root = mkdtempSync(join(tmpdir(), 'specter-jsonl-bench-'))
let sessionNumber = 0
// One directory per session: events.jsonl plus slices/<sliceName>.json.
const nextSessionDirectory = () => join(root, `session-${++sessionNumber}`)
const logPath = (directory: string) => join(directory, 'events.jsonl')

function dependencies(directory: string) {
  return Layer.mergeAll(
    createJsonlEventLogLayer({ path: logPath(directory) }),
    store === 'memory'
      ? createMemorySliceStoreLayer(SessionStore, createSessionState)
      : createJsonlSliceStoreLayer(SessionStore, createSessionState, {
          directory: join(directory, 'slices'),
        }),
    createImmediateReactionSchedulerLayer(),
  )
}

function files(directory: string): { count: number; bytes: number } {
  let count = 0
  let bytes = 0
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      const nested = files(path)
      count += nested.count
      bytes += nested.bytes
    } else {
      count += 1
      bytes += statSync(path).size
    }
  }
  return { count, bytes }
}

async function open(directory = nextSessionDirectory()) {
  const start = performance.now()
  const app: SessionApp = await createSpecterApp(
    sessionAppConfig,
    dependencies(directory),
  )
  const created = performance.now()
  // createSpecterApp resolves after validation and startup (Store resolution,
  // Reaction and eager catch-up), so `create` and `ready` both include it.
  await app.query({ type: 'sessionSummary', payload: {} })
  const ready = performance.now()
  return { app, create: created - start, ready: ready - start }
}

async function time<A>(run: () => Promise<A>) {
  const start = performance.now()
  const value = await run()
  return { value, ms: performance.now() - start }
}

function stats(samples: readonly number[]) {
  const sorted = [...samples].sort((a, b) => a - b)
  const at = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0
  return `p50 ${at(0.5).toFixed(3)} ms  p95 ${at(0.95).toFixed(3)} ms  max ${(sorted.at(-1) ?? 0).toFixed(3)} ms  (n=${sorted.length})`
}

function memory() {
  globalThis.gc?.()
  return process.memoryUsage()
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`

async function runTurn(app: SessionApp, turn: number) {
  const messageId = `assistant-${turn}`
  await app.command({
    type: 'submitUserMessage',
    payload: { messageId: `user-${turn}`, text: `Prompt ${turn}` },
  })
  await app.command({
    type: 'recordAssistantOutput',
    payload: { messageId, kind: 'started', value: 'model-a' },
  })
  for (let part = 0; part < 3; part += 1) {
    await app.command({
      type: 'recordAssistantOutput',
      payload: { messageId, kind: 'text', value: `part ${part} ` },
    })
  }
  const requested = await app.command({
    type: 'requestToolCall',
    payload: { toolCallId: `call-${turn}`, tool: 'read', input: '{}' },
  })
  await requested.reactions
  await app.command({
    type: 'recordToolResult',
    payload: { toolCallId: `call-${turn}`, ok: true, value: 'file contents' },
  })
  await app.command({
    type: 'recordAssistantOutput',
    payload: { messageId, kind: 'completed', value: 'stop' },
  })
}

async function main() {
  console.log(
    `Node ${process.version}, ${count} apps, ${store} Slice Stores, sessions in ${root}`,
  )
  if (!globalThis.gc) console.log('Run with --expose-gc for stable RSS.')

  const conformance = await time(() =>
    Effect.runPromise(collectConformanceDiagnostics(sessionAppConfig)),
  )
  if (conformance.value.length > 0) {
    throw new Error(JSON.stringify(conformance.value, null, 2))
  }
  const conformanceRuns: number[] = []
  for (let index = 0; index < 200; index += 1) {
    conformanceRuns.push(
      (
        await time(() =>
          Effect.runPromise(collectConformanceDiagnostics(sessionAppConfig)),
        )
      ).ms,
    )
  }

  const cold = await open()
  await cold.app.close()

  const before = memory()
  const opened: Awaited<ReturnType<typeof open>>[] = []
  for (let index = 0; index < count; index += 1) opened.push(await open())
  const after = memory()

  const closes: number[] = []
  for (const { app } of opened) closes.push((await time(() => app.close())).ms)
  const readySamples = opened.map((o) => o.ready)
  const createSamples = opened.map((o) => o.create)
  opened.length = 0
  const afterClose = memory()

  const lazy = await time(async () => {
    const app: SessionApp = await createSpecterApp(
      sessionAppConfig,
      dependencies(nextSessionDirectory()),
    )
    await app.command({
      type: 'createSession',
      payload: { sessionId: 'lazy', directory: '/work' },
    })
    return app
  })
  await lazy.value.close()

  const warm = await open()
  const firstCommand = await time(() =>
    warm.app.command({
      type: 'createSession',
      payload: { sessionId: 'warm', directory: '/work' },
    }),
  )
  const secondCommand = await time(async () => {
    const execution = await warm.app.command({
      type: 'submitUserMessage',
      payload: { messageId: 'user-0', text: 'Fix the build' },
    })
    await execution.reactions
  })
  await warm.app.close()

  // Effect-native construction: one shared runtime, one Scope per session.
  const shared = ManagedRuntime.make(Layer.empty)
  const nativeBuilds: number[] = []
  const nativeScopes: Scope.Closeable[] = []
  const nativeBefore = memory()
  for (let index = 0; index < count; index += 1) {
    const start = performance.now()
    const scope = await shared.runPromise(Scope.make())
    await shared.runPromise(
      Layer.buildWithScope(
        createSpecterAppLayer(sessionAppConfig).pipe(
          Layer.provideMerge(dependencies(nextSessionDirectory())),
        ),
        scope,
      ),
    )
    nativeBuilds.push(performance.now() - start)
    nativeScopes.push(scope)
  }
  const nativeAfter = memory()
  for (const scope of nativeScopes) {
    await shared.runPromise(Scope.close(scope, Exit.void))
  }
  await shared.dispose()

  // With memory Slice Stores, reopen cost grows with the log: Reaction cursors
  // start at zero, so startup replays Reactions and the first read of each
  // Slice replays its Events. JSON Slice Stores resume from stored cursors.
  const replay: string[] = []
  for (const turns of [100, 1000]) {
    const directory = nextSessionDirectory()
    const writer = await open(directory)
    await writer.app.command({
      type: 'createSession',
      payload: { sessionId: 'long', directory: '/work' },
    })
    const writeStart = performance.now()
    for (let turn = 0; turn < turns; turn += 1) {
      await runTurn(writer.app, turn)
    }
    const writeMs = performance.now() - writeStart
    await writer.app.close()
    const reopened = await open(directory)
    const transcript = await time(() =>
      reopened.app.query({ type: 'sessionTranscript', payload: {} }),
    )
    const pending = await time(() =>
      reopened.app.query({ type: 'pendingToolCalls', payload: {} }),
    )
    const nextCommand = await time(() =>
      reopened.app.command({
        type: 'submitUserMessage',
        payload: { messageId: 'user-next', text: 'Again' },
      }),
    )
    await reopened.app.close()
    const withoutReactions = await time(async () => {
      const { autoApproveReadTools, titleFromFirstMessage, ...slices } =
        sessionAppConfig.slices
      const app = await createSpecterApp(
        { events: sessionAppConfig.events, slices },
        dependencies(directory),
      )
      await app.query({ type: 'sessionSummary', payload: {} })
      await app.close()
    })
    const session = files(directory)
    replay.push(
      `${turns} turns, ${nextCommand.value.version - 1} events, log ${kb(statSync(logPath(directory)).size)}, ` +
        `${session.count} files, ${kb(session.bytes)} total: ` +
        `write ${(writeMs / turns).toFixed(2)} ms/turn; reopen ready ${reopened.ready.toFixed(1)} ms ` +
        `(without Reactions ${withoutReactions.ms.toFixed(1)} ms); ` +
        `first transcript ${transcript.ms.toFixed(1)} ms (${transcript.value.length} msgs); ` +
        `pending ${pending.ms.toFixed(1)} ms; next command ${nextCommand.ms.toFixed(1)} ms`,
    )
  }

  console.log('\nConformance pass alone (per config)')
  console.log(
    `  first ${conformance.ms.toFixed(3)} ms; ${stats(conformanceRuns)}`,
  )
  console.log('\nPromise edge: createSpecterApp + first query (Layer build)')
  console.log(
    `  cold: createSpecterApp ${cold.create.toFixed(3)} ms, ready ${cold.ready.toFixed(3)} ms`,
  )
  console.log(`  createSpecterApp only: ${stats(createSamples)}`)
  console.log(`  ready:                 ${stats(readySamples)}`)
  console.log(
    `  RSS +${mb(after.rss - before.rss)} for ${count} open apps = ${kb((after.rss - before.rss) / count)}/app; ` +
      `heapUsed ${kb((after.heapUsed - before.heapUsed) / count)}/app`,
  )
  console.log(`  close: ${stats(closes)}`)
  console.log(
    `  after close: RSS ${mb(afterClose.rss)} (was ${mb(before.rss)} before opening), heapUsed ${mb(afterClose.heapUsed)} (was ${mb(before.heapUsed)})`,
  )
  console.log(
    `  fresh app, no warm-up, first command: ${lazy.ms.toFixed(3)} ms (includes Layer build)`,
  )
  console.log(
    `  ready app: first command ${firstCommand.ms.toFixed(3)} ms; ` +
      `second command + Reaction ${secondCommand.ms.toFixed(3)} ms`,
  )
  console.log('\nEffect-native: shared runtime, Layer.buildWithScope per app')
  console.log(`  build: ${stats(nativeBuilds)}`)
  console.log(
    `  heapUsed ${kb((nativeAfter.heapUsed - nativeBefore.heapUsed) / count)}/app, RSS ${kb((nativeAfter.rss - nativeBefore.rss) / count)}/app`,
  )
  console.log('\nReopen with history')
  for (const line of replay) console.log(`  ${line}`)

  rmSync(root, { recursive: true, force: true })
}

await main()
