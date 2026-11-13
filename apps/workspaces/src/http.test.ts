import { afterEach, expect, it } from 'vitest'
import { openWorkspace } from './app'
import { workspaceServer } from './http'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})
async function serve() {
  const app = await openWorkspace()
  const server = workspaceServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('Expected TCP address')
  const base = `http://127.0.0.1:${address.port}`
  cleanups.push(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
    await app.close()
  })
  const post = (value: unknown, key = 'request-1', headers = {}) =>
    fetch(`${base}/api/command`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': key,
        ...headers,
      },
      body: JSON.stringify(value),
    })
  return { base, post }
}
const command = {
  type: 'saveDocument',
  payload: {
    documentId: 'doc-1',
    title: 'Plan',
    body: 'Hello',
    expectedRevision: 0,
  },
}
it('serves the UI and validates, commits, deduplicates and queries over HTTP', async () => {
  const { base, post } = await serve()
  expect(await (await fetch(base)).text()).toContain('Specter Workspaces')
  expect((await post({ type: 'workspace', payload: {} })).status).toBe(400)
  expect((await post({ type: 'saveDocument', payload: {} })).status).toBe(400)
  expect((await post(command)).status).toBe(200)
  expect(await (await post(command)).json()).toMatchObject({ duplicate: true })
  expect(
    (
      await post({
        ...command,
        payload: { ...command.payload, body: 'changed' },
      })
    ).status,
  ).toBe(409)
  expect((await post(command, 'request-2')).status).toBe(409)
  const state = await (await fetch(`${base}/api/workspace`)).json()
  expect(state.documents['doc-1'].body).toBe('Hello')
  expect(
    (await post(command, 'request-3', { origin: 'https://example.com' }))
      .status,
  ).toBe(403)
})
it('streams current state, an updated snapshot, and cleans up on disconnect', async () => {
  const { base, post } = await serve()
  const abort = new AbortController()
  const response = await fetch(`${base}/api/subscribe`, {
    signal: abort.signal,
  })
  expect(response.headers.get('content-type')).toBe('text/event-stream')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Missing stream')
  const decoder = new TextDecoder()
  let buffer = ''
  async function snapshot() {
    while (!buffer.includes('\n\n')) {
      const part = await reader?.read()
      if (part?.done) throw new Error('Stream closed early')
      buffer += decoder.decode(part?.value, { stream: true })
    }
    const boundary = buffer.indexOf('\n\n')
    const frame = buffer.slice(0, boundary)
    buffer = buffer.slice(boundary + 2)
    return JSON.parse(frame.slice('data: '.length))
  }
  try {
    expect((await snapshot()).documents).toEqual({})
    await post(command)
    expect((await snapshot()).documents['doc-1'].body).toBe('Hello')
  } finally {
    abort.abort()
    await reader.cancel().catch(() => {})
  }
  expect((await fetch(`${base}/api/workspace`)).status).toBe(200)
})
