import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { JSDOM } from 'jsdom'
import { expect, it, vi } from 'vitest'
import { openWorkspace } from './app'
import { workspaceServer } from './http'

// DOM simulation, not a substitute for a real-browser visual check. HTTP/SSE has
// separate integration coverage. This exercises the shipped script and handlers.
it('edits, publishes, discusses, creates a task, appends chunks and restores the session DOM', async () => {
  const app = await openWorkspace()
  const server = workspaceServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('Missing server address')
  const base = `http://127.0.0.1:${address.port}`
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const dom = new JSDOM(html, { url: base, runScripts: 'outside-only' })
  const { window } = dom
  const document = window.document
  Object.defineProperty(window, 'crypto', { value: webcrypto })
  window.prompt = () => 'Launch plan'
  window.fetch = (input: string | URL | Request, init?: RequestInit) =>
    fetch(new URL(String(input), base), init)
  class SnapshotSource {
    onopen?: () => void
    onmessage?: (event: { data: string }) => void
    constructor() {
      void fetch(`${base}/api/workspace`)
        .then((response) => response.text())
        .then((data) => {
          this.onopen?.()
          this.onmessage?.({ data })
        })
    }
    close() {}
  }
  Object.defineProperty(window, 'EventSource', { value: SnapshotSource })
  const script = document.querySelector('script[type="module"]')?.textContent
  if (!script) throw new Error('Missing client script')
  const click = (id: string) =>
    (document.getElementById(id) as HTMLButtonElement).click()
  const text = (id: string) => document.getElementById(id)?.textContent
  const wait = (check: () => void) => vi.waitFor(check, { timeout: 5000 })
  try {
    window.eval(script)
    await wait(() => expect(text('connection')).toContain('Live'))
    click('new-document')
    await wait(() => expect(text('title')).toBe('Launch plan'))
    const draft = document.getElementById('draft') as HTMLTextAreaElement
    draft.value = 'Publish the launch plan'
    draft.dispatchEvent(new window.Event('input'))
    await wait(() => expect(text('draft-status')).toBe('Session draft saved.'))
    click('save')
    await wait(() => expect(text('revision')).toContain('2'))
    const message = document.getElementById('message') as HTMLTextAreaElement
    message.value = 'Please review'
    click('send')
    await wait(() => expect(text('messages')).toContain('Please review'))
    const button = (label: string) =>
      Array.from(document.querySelectorAll('button')).find(
        (button) => button.textContent === label,
      )
    button('Create linked task')?.click()
    await wait(() =>
      expect(text('tasks')).toContain('Follow up: Please review'),
    )
    button('Append demo')?.click()
    await wait(() =>
      expect(text('messages')).toContain('Please review · thinking · done'),
    )
    button('○ Open')?.click()
    await wait(() => expect(text('tasks')).toContain('✓ Done'))
    const state = await app.query({ type: 'workspace', payload: {} })
    expect(Object.values(state.documents)[0].body).toBe(
      'Publish the launch plan',
    )
    expect(Object.values(state.views)[0].draft).toBe('Publish the launch plan')
    expect(Object.values(state.views)[0].baseRevision).toBe(2)
    // A fresh script boot uses the persisted session id and initial snapshot.
    document.getElementById('draft')?.removeAttribute('disabled')
    window.eval(script)
    await wait(() =>
      expect(
        (document.getElementById('draft') as HTMLTextAreaElement).value,
      ).toBe('Publish the launch plan'),
    )
  } finally {
    dom.window.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await app.close()
  }
})
