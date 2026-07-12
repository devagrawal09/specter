import type { ToolDefinition } from '../adapters/tool-registry.ts'

export type WebSearchToolInput = {
  query: string
  numResults?: number
  timeoutMs?: number
}

export type WebSearchResult = {
  title: string
  url: string
  snippet: string
}

export type WebSearchToolOutput = {
  query: string
  provider: 'duckduckgo'
  results: WebSearchResult[]
  truncated: boolean
}

type DuckDuckGoTopic = {
  Text?: unknown
  FirstURL?: unknown
  Topics?: unknown
}

type DuckDuckGoResponse = {
  AbstractText?: unknown
  AbstractURL?: unknown
  Heading?: unknown
  RelatedTopics?: unknown
}

const DEFAULT_RESULTS = 8
const MAX_RESULTS = 20
const DEFAULT_TIMEOUT_MS = 25_000
const MAX_TIMEOUT_MS = 60_000

function normalizeQuery(input: string) {
  const query = input.trim()
  if (!query) throw new Error('WebSearch query is required')
  return query
}

function normalizePositiveInteger(value: number | undefined, fallback: number, maximum: number, label: string) {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value < 1) throw new Error(label + ' must be positive')
  return Math.min(Math.floor(value), maximum)
}

function searchUrl(query: string) {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    no_html: '1',
    skip_disambig: '1',
  })
  return 'https://api.duckduckgo.com/?' + params.toString()
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number, abortSignal: AbortSignal | undefined) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const abortFromParent = () => controller.abort()
  abortSignal?.addEventListener('abort', abortFromParent, { once: true })

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'specter-code-websearch',
      },
    })
    if (!response.ok) throw new Error('WebSearch failed with HTTP ' + response.status)
    return (await response.json()) as unknown
  } catch (error) {
    if (controller.signal.aborted) throw new Error('WebSearch request timed out or was aborted')
    throw error
  } finally {
    clearTimeout(timeout)
    abortSignal?.removeEventListener('abort', abortFromParent)
  }
}

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function splitDuckDuckGoText(text: string) {
  const separator = text.indexOf(' - ')
  if (separator === -1) return { title: text, snippet: text }
  return {
    title: text.slice(0, separator).trim(),
    snippet: text.slice(separator + 3).trim(),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseTopic(topic: DuckDuckGoTopic, results: WebSearchResult[]) {
  const nested = Array.isArray(topic.Topics) ? topic.Topics : []
  for (const nestedTopic of nested) {
    if (isRecord(nestedTopic)) parseTopic(nestedTopic, results)
  }

  const text = asString(topic.Text)
  const url = asString(topic.FirstURL)
  if (!text || !url) return

  const { title, snippet } = splitDuckDuckGoText(text)
  results.push({ title, url, snippet })
}

function parseDuckDuckGoResults(body: unknown) {
  const payload = isRecord(body) ? (body as DuckDuckGoResponse) : {}
  const results: WebSearchResult[] = []
  const abstractText = asString(payload.AbstractText)
  const abstractUrl = asString(payload.AbstractURL)
  const heading = asString(payload.Heading)

  if (abstractText && abstractUrl) {
    results.push({
      title: heading || abstractUrl,
      url: abstractUrl,
      snippet: abstractText,
    })
  }

  const relatedTopics = Array.isArray(payload.RelatedTopics) ? payload.RelatedTopics : []
  for (const topic of relatedTopics) {
    if (isRecord(topic)) parseTopic(topic, results)
  }

  return results
}

export const websearchTool: ToolDefinition<WebSearchToolInput, WebSearchToolOutput> = {
  name: 'websearch',
  description: 'Search the web using the DuckDuckGo instant-answer compatible endpoint',
  permission: 'websearch',
  permissionTarget: (input) => input.query.trim(),
  async execute(input, context) {
    try {
      const query = normalizeQuery(input.query)
      const numResults = normalizePositiveInteger(
        input.numResults,
        DEFAULT_RESULTS,
        MAX_RESULTS,
        'WebSearch numResults',
      )
      const timeoutMs = normalizePositiveInteger(
        input.timeoutMs,
        DEFAULT_TIMEOUT_MS,
        MAX_TIMEOUT_MS,
        'WebSearch timeoutMs',
      )
      const url = searchUrl(query)
      const body = await fetchJsonWithTimeout(url, timeoutMs, context.abortSignal)
      const allResults = parseDuckDuckGoResults(body)
      const results = allResults.slice(0, numResults)
      const truncated = allResults.length > results.length

      await context.metadata({
        toolName: 'websearch',
        status: 'completed',
        summary: `Found ${results.length} web result${results.length === 1 ? '' : 's'} for ${query}${truncated ? ' (truncated)' : ''}`,
      })

      return {
        query,
        provider: 'duckduckgo',
        results,
        truncated,
      }
    } catch (error) {
      await context.metadata({
        toolName: 'websearch',
        status: 'failed',
        summary: error instanceof Error ? error.message : 'WebSearch failed',
      })
      throw error
    }
  },
}
