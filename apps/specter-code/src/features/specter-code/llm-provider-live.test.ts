import { describe, expect, it, vi } from 'vitest'

import { runOpenAICompatibleChatCompletion } from './adapters/chat-completions'
import { buildSpecterCodeCli } from './cli/index'

const streamingResponse = (chunks: readonly string[]) => {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  )
}

describe('OpenAI-compatible live provider streaming', () => {
  it('posts chat completions to the configured provider and streams assistant deltas', async () => {
    const deltas: string[] = []
    const fetchImpl = vi.fn(async () =>
      streamingResponse([
        'data: {"choices":[{"delta":{"content":"hello "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"world"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    )

    const result = await runOpenAICompatibleChatCompletion({
      provider: {
        id: 'localai',
        baseUrl: 'http://localhost:11434/v1',
        apiKeyEnv: 'LOCALAI_TOKEN',
      },
      env: { LOCALAI_TOKEN: 'super-secret-token' },
      modelId: 'qwen-code',
      messages: [{ role: 'user', content: 'Say hello' }],
      fetchImpl,
      onDelta: (delta) => deltas.push(delta),
    })

    expect(result).toEqual({ content: 'hello world' })
    expect(deltas).toEqual(['hello ', 'world'])
    expect(fetchImpl).toHaveBeenCalledOnce()
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    const request = init as RequestInit & {
      headers: Record<string, string>
      body: string
    }
    expect(url).toBe('http://localhost:11434/v1/chat/completions')
    expect(request).toMatchObject({ method: 'POST' })
    expect(request.headers).toMatchObject({
      authorization: 'Bearer super-secret-token',
      'content-type': 'application/json',
    })
    expect(JSON.parse(request.body)).toEqual({
      model: 'qwen-code',
      messages: [{ role: 'user', content: 'Say hello' }],
      stream: true,
    })
  })

  it('redacts provider secrets from failed completion errors', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('upstream rejected super-secret-token', {
        status: 401,
        statusText: 'Unauthorized',
      }),
    )

    await expect(
      runOpenAICompatibleChatCompletion({
        provider: {
          id: 'localai',
          baseUrl: 'http://localhost:11434/v1',
          apiKeyEnv: 'LOCALAI_TOKEN',
        },
        env: { LOCALAI_TOKEN: 'super-secret-token' },
        modelId: 'qwen-code',
        messages: [{ role: 'user', content: 'Say hello' }],
        fetchImpl,
      }),
    ).rejects.toThrow('OpenAI-compatible provider localai returned 401 Unauthorized')
  })

  it('lets non-interactive CLI run use a configured live provider instead of mocked output', async () => {
    const fetchImpl = vi.fn(async () =>
      streamingResponse([
        'data: {"choices":[{"delta":{"content":"Live "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"answer"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    )
    const cli = buildSpecterCodeCli({
      cwd: '/tmp/project',
      fetch: fetchImpl,
      env: {
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          model: 'localai/qwen-code',
          provider: {
            localai: {
              name: 'Local AI',
              baseURL: 'http://localhost:11434/v1',
              env: 'LOCALAI_TOKEN',
              models: { 'qwen-code': { name: 'Qwen Code' } },
            },
          },
        }),
        LOCALAI_TOKEN: 'super-secret-token',
      },
    })

    const result = await cli.run(['run', '--live', '--format', 'json', 'explain', 'repo'])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    const events = result.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; [key: string]: unknown })
    expect(events.map((event) => event.type)).toEqual([
      'session.created',
      'message.created',
      'run.started',
      'assistant.delta',
      'assistant.delta',
      'assistant.message',
      'run.completed',
    ])
    expect(events[2]).toMatchObject({
      type: 'run.started',
      model: 'localai/qwen-code',
      modelConfigured: true,
    })
    expect(events[5]).toMatchObject({
      type: 'assistant.message',
      content: 'Live answer',
    })
    expect(result.stdout).not.toContain('Mocked')
    expect(result.stdout).not.toContain('super-secret-token')
  })
})
