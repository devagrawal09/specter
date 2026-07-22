import { describe, expect, test, vi } from 'vitest'

import { createAiAnalyzer } from './ai.server'

const effect = {
  analysisId: 'analysis-1',
  threadId: 'thread-1',
  provider: 'local' as const,
  sender: 'ada@example.com',
  subject: 'Review',
  bodyText: 'Please review the build.',
}

describe('AI adapter', () => {
  test('uses the local endpoint by default and validates structured output', async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: 'Review requested.',
                priority: 'high',
                suggestedAction: 'reply',
              }),
            },
          },
        ],
      }),
    )
    const result = await createAiAnalyzer({ fetch, env: {} }).analyze(effect)
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/v1/chat/completions',
      expect.objectContaining({ method: 'POST', redirect: 'error' }),
    )
    expect(result).toEqual({
      summary: 'Review requested.',
      priority: 'high',
      suggestedAction: 'reply',
    })
  })

  test('does not infer cloud configuration from local settings', async () => {
    const analyzer = createAiAnalyzer({
      fetch: vi.fn(),
      env: { AI_LOCAL_BASE_URL: 'http://127.0.0.1:9999/v1' },
    })
    await expect(
      analyzer.analyze({ ...effect, provider: 'cloud' }),
    ).rejects.toThrow('Cloud AI is not configured')
  })

  test('refuses to send default-local analysis to a non-loopback host', async () => {
    const fetch = vi.fn()
    const analyzer = createAiAnalyzer({
      fetch,
      env: { AI_LOCAL_BASE_URL: 'https://ai.example.com/v1' },
    })
    await expect(analyzer.analyze(effect)).rejects.toThrow(
      'Local AI endpoint must use a loopback host',
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  test('rejects malformed provider output', async () => {
    const analyzer = createAiAnalyzer({
      fetch: vi.fn(async () =>
        Response.json({
          choices: [{ message: { content: '{"priority":"urgent"}' } }],
        }),
      ),
      env: {},
    })
    await expect(analyzer.analyze(effect)).rejects.toThrow()
  })
})
