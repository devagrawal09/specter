import type { ProviderSummary } from './llm-provider.ts'

export type OpenAICompatibleChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
}

export type SpecterCodeFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export type OpenAICompatibleChatCompletionOptions = {
  provider: Pick<ProviderSummary, 'id' | 'baseUrl' | 'apiKeyEnv'>
  env?: Record<string, string | undefined>
  modelId: string
  messages: readonly OpenAICompatibleChatMessage[]
  fetchImpl?: SpecterCodeFetch
  onDelta?: (delta: string) => void
  signal?: AbortSignal
}

export type OpenAICompatibleChatCompletionResult = {
  content: string
}

export async function runOpenAICompatibleChatCompletion(
  options: OpenAICompatibleChatCompletionOptions,
): Promise<OpenAICompatibleChatCompletionResult> {
  const env = options.env ?? process.env
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (!fetchImpl)
    throw new Error(
      'No fetch implementation is available for live provider runs',
    )

  const baseUrl = resolveOpenAICompatibleBaseUrl(options.provider)
  const apiKey = readProviderApiKey(options.provider, env)
  const response = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: options.modelId,
      messages: options.messages,
      stream: true,
    }),
    signal: options.signal,
  })

  if (!response.ok) {
    // Do not include the response body: upstream error payloads can echo prompts or credentials.
    throw new Error(
      `OpenAI-compatible provider ${options.provider.id} returned ${response.status} ${response.statusText}`,
    )
  }

  if (!response.body) {
    throw new Error(
      `OpenAI-compatible provider ${options.provider.id} returned an empty stream`,
    )
  }

  return readOpenAICompatibleSseStream(response.body, options.onDelta)
}

function resolveOpenAICompatibleBaseUrl(
  provider: Pick<ProviderSummary, 'id' | 'baseUrl'>,
) {
  const baseUrl =
    provider.baseUrl?.trim() ||
    (provider.id === 'openai' ? 'https://api.openai.com/v1' : '')
  if (!baseUrl) {
    throw new Error(
      `OpenAI-compatible provider ${provider.id} is missing a base URL`,
    )
  }
  return baseUrl.replace(/\/+$/g, '')
}

function readProviderApiKey(
  provider: Pick<ProviderSummary, 'id' | 'apiKeyEnv'>,
  env: Record<string, string | undefined>,
) {
  const apiKeyEnv = provider.apiKeyEnv
  const apiKey = apiKeyEnv ? env[apiKeyEnv]?.trim() : ''
  if (!apiKey) {
    const detail = apiKeyEnv
      ? `missing ${apiKeyEnv}`
      : 'missing provider apiKeyEnv'
    throw new Error(
      `OpenAI-compatible provider ${provider.id} is not configured: ${detail}`,
    )
  }
  return apiKey
}

async function readOpenAICompatibleSseStream(
  body: ReadableStream<Uint8Array>,
  onDelta: ((delta: string) => void) | undefined,
): Promise<OpenAICompatibleChatCompletionResult> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parsed = drainSseBuffer(buffer)
      buffer = parsed.remainder
      for (const event of parsed.events) {
        if (event === '[DONE]') return { content }
        const delta = readDeltaFromSseEvent(event)
        if (!delta) continue
        content += delta
        onDelta?.(delta)
      }
    }
  } finally {
    reader.releaseLock()
  }

  buffer += decoder.decode()
  for (const event of drainFinalSseBuffer(buffer)) {
    if (event === '[DONE]') return { content }
    const delta = readDeltaFromSseEvent(event)
    if (!delta) continue
    content += delta
    onDelta?.(delta)
  }

  return { content }
}

function drainSseBuffer(buffer: string) {
  const normalized = buffer.replaceAll('\r\n', '\n')
  const parts = normalized.split('\n\n')
  const remainder = parts.pop() ?? ''
  return { events: parts.flatMap(readSseDataPayload), remainder }
}

function drainFinalSseBuffer(buffer: string) {
  const trimmed = buffer.trim()
  if (!trimmed) return []
  return readSseDataPayload(trimmed)
}

function readSseDataPayload(block: string) {
  const data = block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim())
    .join('\n')
    .trim()
  return data ? [data] : []
}

function readDeltaFromSseEvent(event: string) {
  const payload = JSON.parse(event) as unknown
  if (!payload || typeof payload !== 'object') return ''
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices)) return ''
  const first = choices[0]
  if (!first || typeof first !== 'object') return ''
  const delta = (first as { delta?: unknown }).delta
  if (!delta || typeof delta !== 'object') return ''
  const content = (delta as { content?: unknown }).content
  return typeof content === 'string' ? content : ''
}
