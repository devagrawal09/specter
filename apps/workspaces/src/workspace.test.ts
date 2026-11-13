import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { config, openWorkspace, type WorkspaceApp } from './app'
import { testSliceImplementations } from '@specter-ts/core/testing'
import { Effect, Layer } from 'effect'
import { createMemorySliceStoreLayer } from '@specter-ts/memory'
import {
  Store as DocumentStore,
  createState as documentState,
} from './features/workspace/save-document/impl'
import {
  Store as MessageStore,
  createState as messageState,
} from './features/workspace/post-message/impl'
import {
  Store as TaskStore,
  createState as taskState,
} from './features/workspace/set-task/impl'
import {
  Store as ViewStore,
  createState as viewState,
} from './features/workspace/set-view/impl'
import {
  Store as StreamStore,
  createState as streamState,
} from './features/workspace/append-message/impl'
import {
  Store as QueryStore,
  createState as queryState,
} from './features/workspace/workspace/impl'

const stores = Layer.mergeAll(
  createMemorySliceStoreLayer(DocumentStore, documentState),
  createMemorySliceStoreLayer(MessageStore, messageState),
  createMemorySliceStoreLayer(TaskStore, taskState),
  createMemorySliceStoreLayer(ViewStore, viewState),
  createMemorySliceStoreLayer(StreamStore, streamState),
  createMemorySliceStoreLayer(QueryStore, queryState),
)
testSliceImplementations(config.slices, {
  events: config.events,
  runScenario: (program) =>
    Effect.runPromise(
      Effect.provide(program, stores) as Effect.Effect<never, unknown>,
    ),
})

const directories: string[] = []
const apps: WorkspaceApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close()
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})
const directory = () => {
  const path = mkdtempSync(join(tmpdir(), 'specter-workspaces-'))
  directories.push(path)
  return path
}
const query = (app: WorkspaceApp) =>
  app.query({ type: 'workspace', payload: {} })
const doc = {
  documentId: 'doc-1',
  title: 'Plan',
  body: 'Ship',
  expectedRevision: 0,
}
async function seed(app: WorkspaceApp) {
  await app.command({ type: 'saveDocument', payload: doc })
  await app.command({
    type: 'postMessage',
    payload: { messageId: 'msg-1', documentId: 'doc-1', text: 'Review' },
  })
  await app.command({
    type: 'setTask',
    payload: {
      taskId: 'task-1',
      messageId: 'msg-1',
      title: 'Review plan',
      done: false,
      expectedRevision: 0,
    },
  })
  await app.command({
    type: 'setView',
    payload: {
      sessionId: 'session-1',
      documentId: 'doc-1',
      draft: 'Unsent',
      baseRevision: 1,
      expectedRevision: 0,
    },
  })
}
for (const mode of ['memory', 'jsonl'] as const)
  describe(mode, () => {
    const open = async () => {
      const app = await openWorkspace(
        mode === 'jsonl' ? directory() : undefined,
      )
      apps.push(app)
      return app
    }
    it('connects documents, messages, tasks and physical session state', async () => {
      const app = await open()
      await seed(app)
      const state = await query(app)
      expect(state.messages['msg-1'].documentId).toBe('doc-1')
      expect(state.tasks['task-1'].messageId).toBe('msg-1')
      expect(state.views['session-1'].draft).toBe('Unsent')
    })
    it('serializes competing edits and preserves an unrelated document revision', async () => {
      const app = await open()
      await seed(app)
      await app.command({
        type: 'saveDocument',
        payload: { ...doc, documentId: 'doc-2' },
      })
      const results = await Promise.allSettled(
        ['A', 'B'].map((body) =>
          app.command({
            type: 'saveDocument',
            payload: { ...doc, body, expectedRevision: 1 },
          }),
        ),
      )
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1)
      expect(
        results.filter((result) => result.status === 'rejected'),
      ).toHaveLength(1)
      expect((await query(app)).documents['doc-1'].revision).toBe(2)
      expect((await query(app)).documents['doc-2'].revision).toBe(1)
    })
    it('delivers an initial snapshot and accumulated stream state to two subscribers', async () => {
      const app = await open()
      await seed(app)
      const abort = new AbortController()
      const first = app
        .subscribe({ type: 'workspace', payload: {} }, { signal: abort.signal })
        [Symbol.asyncIterator]()
      const second = app
        .subscribe({ type: 'workspace', payload: {} }, { signal: abort.signal })
        [Symbol.asyncIterator]()
      try {
        expect((await first.next()).value?.messages['msg-1'].text).toBe(
          'Review',
        )
        await second.next()
        const next = first.next()
        for (const [offset, chunk] of [
          [6, ' now'],
          [10, '!'],
        ] as const)
          await app.command({
            type: 'appendMessage',
            payload: { messageId: 'msg-1', offset, chunk },
          })
        expect((await next).value?.messages['msg-1'].text).toMatch(
          /^Review now/,
        )
        expect((await second.next()).value?.messages['msg-1'].text).toBe(
          'Review now!',
        )
        expect((await query(app)).messages['msg-1'].text).toBe('Review now!')
      } finally {
        abort.abort()
        await first.return?.()
        await second.return?.()
      }
    })
    it('deduplicates retries and rejects a changed payload in exact mode', async () => {
      const app = await open()
      const command = { type: 'saveDocument', payload: doc } as const
      const original = await app.command(command, {
        idempotencyKey: 'request-1',
        idempotencyMode: 'exact',
      })
      const retry = await app.command(command, {
        idempotencyKey: 'request-1',
        idempotencyMode: 'exact',
      })
      expect(retry.duplicate).toBe(true)
      expect(retry.version).toBe(original.version)
      await expect(
        app.command(
          { ...command, payload: { ...doc, body: 'Different' } },
          { idempotencyKey: 'request-1', idempotencyMode: 'exact' },
        ),
      ).rejects.toMatchObject({ code: 'SPECTER_IDEMPOTENCY_CONFLICT' })
    })
  })
it('restores session drafts and content, then rebuilds all projections from the same log', async () => {
  const path = directory()
  const first = await openWorkspace(path)
  await seed(first)
  await first.command({
    type: 'appendMessage',
    payload: { messageId: 'msg-1', offset: 6, chunk: ' now' },
  })
  const before = await query(first)
  await first.close()
  const reopened = await openWorkspace(path)
  expect(await query(reopened)).toEqual(before)
  await reopened.close()
  rmSync(join(path, 'slices'), { recursive: true })
  const replayed = await openWorkspace(path)
  apps.push(replayed)
  expect(await query(replayed)).toEqual(before)
  expect(
    readFileSync(join(path, 'events.jsonl'), 'utf8').trim().split('\n'),
  ).toHaveLength(5)
})
it('refuses a second writer instead of pretending to offer multiprocess concurrency', async () => {
  const path = directory()
  const app = await openWorkspace(path)
  apps.push(app)
  await expect(openWorkspace(path)).rejects.toThrow()
})

it('retains the draft base revision so a later publication cannot silently overwrite an intervening edit', async () => {
  const app = await openWorkspace()
  apps.push(app)
  await seed(app)
  await app.command({
    type: 'saveDocument',
    payload: { ...doc, body: 'Someone else edited', expectedRevision: 1 },
  })
  const draft = (await query(app)).views['session-1']
  expect(draft.baseRevision).toBe(1)
  await expect(
    app.command({
      type: 'saveDocument',
      payload: {
        ...doc,
        body: draft.draft,
        expectedRevision: draft.baseRevision,
      },
    }),
  ).rejects.toMatchObject({ code: 'SPECTER_COMMAND_REJECTED' })
  expect((await query(app)).documents['doc-1'].body).toBe('Someone else edited')
})
