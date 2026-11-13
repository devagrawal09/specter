import { mkdtempSync, readdirSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { openWorkspace } from './app'

// Local diagnostic, not a performance guarantee. Includes 100 sequential commits,
// each with an exact retry fingerprint and a full accumulated query after commit.
for (const mode of ['memory', 'jsonl'] as const) {
  const directory = mkdtempSync(join(tmpdir(), 'specter-workspaces-measure-'))
  let app = await openWorkspace(mode === 'jsonl' ? directory : undefined)
  try {
    await app.command({
      type: 'saveDocument',
      payload: {
        documentId: 'doc-1',
        title: 'Measure',
        body: '',
        expectedRevision: 0,
      },
    })
    await app.command({
      type: 'postMessage',
      payload: { messageId: 'msg-1', documentId: 'doc-1', text: '' },
    })
    const samples: number[] = []
    const start = performance.now()
    for (let offset = 0; offset < 100; offset++) {
      const before = performance.now()
      await app.command(
        {
          type: 'appendMessage',
          payload: { messageId: 'msg-1', offset, chunk: 'x' },
        },
        { idempotencyKey: `chunk-${offset}`, idempotencyMode: 'exact' },
      )
      await app.query({ type: 'workspace', payload: {} })
      samples.push(performance.now() - before)
    }
    const elapsedMs = performance.now() - start
    samples.sort((a, b) => a - b)
    const bytes =
      mode === 'jsonl' ? statSync(join(directory, 'events.jsonl')).size : 0
    const projectionBytes =
      mode === 'jsonl'
        ? readdirSync(join(directory, 'slices')).reduce(
            (sum, file) => sum + statSync(join(directory, 'slices', file)).size,
            0,
          )
        : 0
    let reopenQueryMs: number | undefined
    let rebuildQueryMs: number | undefined
    if (mode === 'jsonl') {
      await app.close()
      let before = performance.now()
      app = await openWorkspace(directory)
      await app.query({ type: 'workspace', payload: {} })
      reopenQueryMs = +(performance.now() - before).toFixed(2)
      await app.close()
      rmSync(join(directory, 'slices'), { recursive: true })
      before = performance.now()
      app = await openWorkspace(directory)
      const rebuilt = await app.query({ type: 'workspace', payload: {} })
      rebuildQueryMs = +(performance.now() - before).toFixed(2)
      if (rebuilt.messages['msg-1'].text !== 'x'.repeat(100))
        throw new Error('Rebuild lost stream text')
    }
    console.log(
      JSON.stringify({
        mode,
        chunks: 100,
        elapsedMs: Math.round(elapsedMs),
        medianMs: +samples[50].toFixed(2),
        p95Ms: +samples[95].toFixed(2),
        eventLogBytes: bytes,
        projectionBytes,
        finalTextBytes: 100,
        reopenQueryMs,
        rebuildQueryMs,
      }),
    )
  } finally {
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
}
