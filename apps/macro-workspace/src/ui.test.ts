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
  const snapshots: Promise<void>[] = []
  class SnapshotSource {
    onopen?: () => void
    onmessage?: (event: { data: string }) => void
    constructor() {
      const ready = fetch(`${base}/api/workspace`)
        .then((response) => response.text())
        .then((data) => {
          this.onopen?.()
          this.onmessage?.({ data })
        })
      snapshots.push(ready)
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
    ;(document.getElementById('draft') as HTMLTextAreaElement).value = ''
    window.eval(script)
    await snapshots.at(-1)
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

it('keeps a focused stale draft tied to its own revisions across two active tabs', async () => {
  const app = await openWorkspace()
  const server = workspaceServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('Missing server address')
  const base = `http://127.0.0.1:${address.port}`
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const tabs: JSDOM[] = []
  const sources: { close: () => void }[] = []
  const streamErrors: unknown[] = []
  const wait = (check: () => void) => vi.waitFor(check, { timeout: 5000 })
  function tab() {
    const dom = new JSDOM(html, { url: base, runScripts: 'outside-only' })
    tabs.push(dom)
    const { window } = dom
    Object.defineProperty(window, 'crypto', { value: webcrypto })
    window.localStorage.setItem('specter-macro-session', 'session-shared')
    window.prompt = () => 'Shared plan'
    window.fetch = (input: string | URL | Request, init?: RequestInit) =>
      fetch(new URL(String(input), base), init)
    // EventSource compatibility shim consumes the actual HTTP/SSE endpoint.
    class Source {
      onopen?: () => void
      onmessage?: (event: { data: string }) => void
      readonly abort = new AbortController()
      constructor(path: string) {
        sources.push(this)
        void this.run(path).catch((error) => {
          if (!this.abort.signal.aborted) streamErrors.push(error)
        })
      }
      async run(path: string) {
        const response = await fetch(new URL(path, base), {
          signal: this.abort.signal,
        })
        const reader = response.body?.getReader()
        if (!reader) throw new Error('Missing SSE body')
        this.onopen?.()
        const decoder = new TextDecoder()
        let buffer = ''
        try {
          for (;;) {
            const part = await reader.read()
            if (part.done) return
            buffer += decoder.decode(part.value, { stream: true })
            while (buffer.includes('\n\n')) {
              const end = buffer.indexOf('\n\n')
              const frame = buffer.slice(0, end)
              buffer = buffer.slice(end + 2)
              this.onmessage?.({ data: frame.slice('data: '.length) })
            }
          }
        } finally {
          await reader.cancel().catch(() => {})
        }
      }
      close() {
        this.abort.abort()
      }
    }
    Object.defineProperty(window, 'EventSource', { value: Source })
    const script = window.document.querySelector(
      'script[type="module"]',
    )?.textContent
    if (!script) throw new Error('Missing script')
    window.eval(script)
    return {
      draft: window.document.getElementById('draft') as HTMLTextAreaElement,
      click: (id: string) =>
        (window.document.getElementById(id) as HTMLButtonElement).click(),
      text: (id: string) => window.document.getElementById(id)?.textContent,
      input: (text: string) => {
        const draft = window.document.getElementById(
          'draft',
        ) as HTMLTextAreaElement
        draft.focus()
        draft.value = text
        draft.dispatchEvent(new window.Event('input'))
      },
    }
  }
  try {
    const first = tab(),
      second = tab()
    await wait(() => expect(first.text('connection')).toContain('Live'))
    await wait(() => expect(second.text('connection')).toContain('Live'))
    first.click('new-document')
    await wait(() => expect(second.draft.disabled).toBe(false))
    second.draft.focus()
    expect(second.draft.value).toBe('')
    first.input('Published by the other tab')
    await wait(() =>
      expect(first.text('draft-status')).toBe('Session draft saved.'),
    )
    first.click('save')
    await wait(() =>
      expect(first.text('status')).toBe('Published document revision.'),
    )
    await wait(() => expect(second.text('revision')).toContain('2'))
    expect(second.draft.value).toBe('')
    second.input('Stale text with another keystroke')
    await wait(() =>
      expect(`${second.text('status')} ${second.text('draft-status')}`).toMatch(
        /conflict|saved/i,
      ),
    )
    expect(second.text('status')).toContain('View revision conflict')
    expect(second.draft.value).toBe('Stale text with another keystroke')
    expect(
      (tabs[1].window.document.getElementById('save') as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    second.click('save')
    const state = await app.query({ type: 'workspace', payload: {} })
    expect(Object.values(state.documents)[0]).toMatchObject({
      body: 'Published by the other tab',
      revision: 2,
    })
    expect(state.views['session-shared']).toMatchObject({
      draft: 'Published by the other tab',
      baseRevision: 2,
    })
    // Explicitly reselecting loads text and both revisions together, enabling
    // a new edit while the original tab still holds its older focused text.
    const select = Array.from(
      tabs[1].window.document.querySelectorAll('#documents button'),
    ).find(
      (button) => button.textContent === 'Shared plan',
    ) as HTMLButtonElement
    select.click()
    await wait(() =>
      expect(second.draft.value).toBe('Published by the other tab'),
    )
    second.input('Explicitly reloaded and edited')
    await wait(() =>
      expect(second.text('draft-status')).toBe('Session draft saved.'),
    )
    second.click('save')
    await wait(() =>
      expect(second.text('status')).toBe('Published document revision.'),
    )
    const afterReload = await app.query({ type: 'workspace', payload: {} })
    expect(Object.values(afterReload.documents)[0]).toMatchObject({
      body: 'Explicitly reloaded and edited',
      revision: 3,
    })
    expect(afterReload.views['session-shared'].baseRevision).toBe(3)
    expect(first.draft.value).toBe('Published by the other tab')
    expect(streamErrors).toEqual([])
  } finally {
    for (const source of sources) source.close()
    for (const dom of tabs) dom.window.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await app.close()
  }
})
