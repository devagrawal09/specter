import type { ToolDefinition } from '../adapters/tool-registry.ts'

export type WebFetchFormat = 'markdown' | 'text' | 'html'

export type WebFetchToolInput = {
  url: string
  format?: WebFetchFormat
  timeoutMs?: number
  maxBytes?: number
}

export type WebFetchToolOutput = {
  url: string
  status: number
  contentType: string
  format: WebFetchFormat
  content: string
  truncated: boolean
}

const DEFAULT_FORMAT: WebFetchFormat = 'markdown'
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 120_000
const DEFAULT_MAX_BYTES = 200_000
const ABSOLUTE_MAX_BYTES = 1_000_000

function normalizeUrl(input: string) {
  const trimmed = input.trim()
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('URL must start with http:// or https://')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('URL must start with http:// or https://')
  }

  return url.toString()
}

function normalizeFormat(format: WebFetchFormat | undefined): WebFetchFormat {
  if (format === undefined) return DEFAULT_FORMAT
  if (format === 'markdown' || format === 'text' || format === 'html') return format
  throw new Error('WebFetch format must be markdown, text, or html')
}

function normalizePositiveInteger(value: number | undefined, fallback: number, maximum: number, label: string) {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value < 1) throw new Error(label + ' must be positive')
  return Math.min(Math.floor(value), maximum)
}

async function fetchWithTimeout(url: string, timeoutMs: number, abortSignal: AbortSignal | undefined) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const abortFromParent = () => controller.abort()
  abortSignal?.addEventListener('abort', abortFromParent, { once: true })

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept:
          'text/markdown, text/plain;q=0.9, text/html;q=0.8, application/xhtml+xml;q=0.7, */*;q=0.1',
        'User-Agent': 'specter-code-webfetch',
      },
    })
  } catch (error) {
    if (controller.signal.aborted) throw new Error('WebFetch request timed out or was aborted')
    throw error
  } finally {
    clearTimeout(timeout)
    abortSignal?.removeEventListener('abort', abortFromParent)
  }
}

function decodeHtmlEntities(input: string) {
  return input
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
}

function htmlBody(html: string) {
  const match = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)
  return match?.[1] ?? html
}

function removeIgnoredHtml(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
}

function normalizeMarkdownWhitespace(input: string) {
  const lines = decodeHtmlEntities(input)
    .replace(/[ \t]+\n/g, '\n')
    .split(/\r?\n/)
    .map((line) => line.trim())

  const output: string[] = []
  for (const line of lines) {
    if (!line) {
      if (output.length > 0 && output[output.length - 1] !== '') output.push('')
      continue
    }
    output.push(line)
  }

  while (output[output.length - 1] === '') output.pop()
  return output.join('\n')
}

function htmlToText(html: string) {
  return decodeHtmlEntities(
    removeIgnoredHtml(htmlBody(html))
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<\/(p|div|section|article|h[1-6]|li)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function htmlToMarkdown(html: string) {
  const markdown = removeIgnoredHtml(htmlBody(html))
    .replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n\n')
    .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n\n')
    .replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n\n')
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/(strong|b)>/gi, '**$2**')
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/(em|i)>/gi, '*$2*')
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1')
    .replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n\n')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')

  return normalizeMarkdownWhitespace(markdown)
}

function renderContent(content: string, contentType: string, format: WebFetchFormat) {
  const isHtml = contentType.toLowerCase().includes('text/html')
  if (format === 'html' || !isHtml) return content.trim()
  if (format === 'text') return htmlToText(content)
  return htmlToMarkdown(content)
}

export const webfetchTool: ToolDefinition<WebFetchToolInput, WebFetchToolOutput> = {
  name: 'webfetch',
  description: 'Fetch web content from an HTTP or HTTPS URL',
  permission: 'webfetch',
  permissionTarget: (input) => input.url.trim(),
  async execute(input, context) {
    try {
      const url = normalizeUrl(input.url)
      const format = normalizeFormat(input.format)
      const timeoutMs = normalizePositiveInteger(
        input.timeoutMs,
        DEFAULT_TIMEOUT_MS,
        MAX_TIMEOUT_MS,
        'WebFetch timeoutMs',
      )
      const maxBytes = normalizePositiveInteger(
        input.maxBytes,
        DEFAULT_MAX_BYTES,
        ABSOLUTE_MAX_BYTES,
        'WebFetch maxBytes',
      )
      const response = await fetchWithTimeout(url, timeoutMs, context.abortSignal)
      if (!response.ok) throw new Error('WebFetch failed with HTTP ' + response.status)

      const contentType = response.headers.get('content-type') ?? ''
      const bytes = new Uint8Array(await response.arrayBuffer())
      const truncated = bytes.byteLength > maxBytes
      const decoded = new TextDecoder().decode(bytes.subarray(0, maxBytes))
      const content = renderContent(decoded, contentType, format)

      await context.metadata({
        toolName: 'webfetch',
        status: 'completed',
        summary: `Fetched ${url} as ${format}${truncated ? ' (truncated)' : ''}`,
      })

      return {
        url,
        status: response.status,
        contentType,
        format,
        content,
        truncated,
      }
    } catch (error) {
      await context.metadata({
        toolName: 'webfetch',
        status: 'failed',
        summary: error instanceof Error ? error.message : 'WebFetch failed',
      })
      throw error
    }
  },
}
