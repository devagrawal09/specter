import { afterEach, describe, expect, it, vi } from 'vitest'

import { createToolRegistry, type ToolContext } from './adapters/tool-registry'
import { webfetchTool } from './tools/webfetch'
import { websearchTool } from './tools/websearch'

const originalFetch = globalThis.fetch

const createContext = (overrides: Partial<ToolContext> = {}): ToolContext => ({
  sessionId: 'session-web-1',
  messageId: 'message-web-1',
  agent: 'build',
  workspaceRoot: '/workspace/project',
  abortSignal: new AbortController().signal,
  ask: vi.fn(async () => 'allow' as const),
  metadata: vi.fn(),
  ...overrides,
})

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('web tools', () => {
  it('fetches HTML through registry permission and returns normalized markdown', async () => {
    const registry = createToolRegistry()
    registry.register(webfetchTool)
    const context = createContext()
    const response = new Response(
      '<html><head><title>Ignored</title><style>.x{}</style></head><body><h1>Release Notes</h1><p>Hello <strong>Specter</strong></p><script>bad()</script></body></html>',
      { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
    )
    globalThis.fetch = vi.fn(async () => response) as typeof fetch

    await expect(
      registry.execute('webfetch', { url: 'https://example.com/releases', format: 'markdown' }, context),
    ).resolves.toEqual({
      url: 'https://example.com/releases',
      status: 200,
      contentType: 'text/html; charset=utf-8',
      format: 'markdown',
      content: '# Release Notes\n\nHello **Specter**',
      truncated: false,
    })
    expect(context.ask).toHaveBeenCalledWith({
      permission: 'webfetch',
      target: 'https://example.com/releases',
    })
    expect(context.metadata).toHaveBeenCalledWith({
      toolName: 'webfetch',
      status: 'completed',
      summary: 'Fetched https://example.com/releases as markdown',
    })
  })

  it('rejects non-http webfetch URLs before making a request', async () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch
    const context = createContext()

    await expect(webfetchTool.execute({ url: 'file:///etc/passwd' }, context)).rejects.toThrow(
      'URL must start with http:// or https://',
    )
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(context.metadata).toHaveBeenCalledWith({
      toolName: 'webfetch',
      status: 'failed',
      summary: 'URL must start with http:// or https://',
    })
  })

  it('searches the web with the DuckDuckGo-compatible endpoint and caps result count', async () => {
    const registry = createToolRegistry()
    registry.register(websearchTool)
    const context = createContext()
    const response = Response.json({
      AbstractText: 'Specter is an event-sourced app framework.',
      AbstractURL: 'https://specter.dev/',
      Heading: 'Specter',
      RelatedTopics: [
        { Text: 'Specter docs - durable workflows', FirstURL: 'https://specter.dev/docs' },
        {
          Name: 'Nested',
          Topics: [
            { Text: 'Specter examples - reference apps', FirstURL: 'https://specter.dev/examples' },
          ],
        },
      ],
    })
    globalThis.fetch = vi.fn(async () => response) as typeof fetch

    await expect(
      registry.execute('websearch', { query: 'specter framework', numResults: 2 }, context),
    ).resolves.toEqual({
      query: 'specter framework',
      provider: 'duckduckgo',
      results: [
        {
          title: 'Specter',
          url: 'https://specter.dev/',
          snippet: 'Specter is an event-sourced app framework.',
        },
        {
          title: 'Specter docs',
          url: 'https://specter.dev/docs',
          snippet: 'durable workflows',
        },
      ],
      truncated: true,
    })
    expect(context.ask).toHaveBeenCalledWith({
      permission: 'websearch',
      target: 'specter framework',
    })
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.duckduckgo.com/?q=specter+framework&format=json&no_html=1&skip_disambig=1',
      expect.objectContaining({ headers: expect.objectContaining({ Accept: 'application/json' }) }),
    )
  })
})
