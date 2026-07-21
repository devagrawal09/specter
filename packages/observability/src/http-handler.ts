import {
  assertRuntimeObservationBatch,
  protocolErrorCodes,
  SpecterProtocolError,
  structuredProtocolError,
} from '@specter-ts/protocol'

import type {
  RuntimeActivityFilter,
  RuntimeTraceFilter,
} from './collector-model'
import type { SpecterObservabilityCollector } from './collector'
import { renderCollectorHtml } from './ui'

export type SpecterObservabilityHttpHandlerOptions = {
  readonly collector: SpecterObservabilityCollector
  readonly basePath?: string
  readonly signal?: AbortSignal
}

export function createSpecterObservabilityHttpHandler(
  options: SpecterObservabilityHttpHandlerOptions,
) {
  const basePath =
    `/${(options.basePath ?? '').replace(/^\/+|\/+$/g, '')}`.replace(/\/$/, '')

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (
      basePath &&
      !url.pathname.startsWith(`${basePath}/`) &&
      url.pathname !== basePath
    ) {
      return errorResponse(
        404,
        'SPECTER_OBSERVABILITY_ROUTE_NOT_FOUND',
        'Route not found.',
      )
    }
    const route = url.pathname.slice(basePath.length) || '/'
    const isObservationProtocolRoute = route === '/specter/v1/observations'

    try {
      if (request.method === 'GET' && route === '/') {
        return new Response(renderCollectorHtml(basePath), {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
      }
      if (request.method === 'POST' && route === '/specter/v1/observations') {
        requireJsonContentType(request)
        const body = await readJson(request)
        assertRuntimeObservationBatch(body)
        return Response.json(await options.collector.ingest(body), {
          status: 202,
          headers: { 'Specter-Protocol-Version': '1' },
        })
      }
      if (request.method === 'GET' && route === '/v1/overview') {
        return Response.json(await options.collector.overview())
      }
      if (request.method === 'GET' && route === '/v1/activity') {
        return Response.json(
          await options.collector.activity(filterFromUrl(url)),
        )
      }
      if (request.method === 'GET' && route.startsWith('/v1/traces/')) {
        const operationId = decodeURIComponent(
          route.slice('/v1/traces/'.length),
        )
        if (!operationId) {
          return errorResponse(
            400,
            'SPECTER_INVALID_OPERATION_ID',
            'operationId is required.',
          )
        }
        return Response.json(
          await options.collector.trace(operationId, traceFilterFromUrl(url)),
        )
      }
      if (request.method === 'GET' && route === '/v1/stream') {
        const signal = options.signal
          ? AbortSignal.any([request.signal, options.signal])
          : request.signal
        return streamActivity(options.collector, filterFromUrl(url), signal)
      }
      return errorResponse(
        404,
        'SPECTER_OBSERVABILITY_ROUTE_NOT_FOUND',
        'Route not found.',
      )
    } catch (cause) {
      const error = structuredProtocolError(cause)
      return errorResponse(
        cause instanceof SpecterProtocolError ? cause.status : 500,
        error.code,
        error.message,
        isObservationProtocolRoute,
      )
    }
  }

  return handle
}

function requireJsonContentType(request: Request) {
  const contentType = request.headers.get('content-type')
  if (
    contentType?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
  ) {
    return
  }
  throw new SpecterProtocolError({
    code: protocolErrorCodes.invalidMessage,
    message: 'Protocol POST requests require application/json.',
    status: 415,
  })
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch (cause) {
    throw new SpecterProtocolError({
      code: protocolErrorCodes.invalidJson,
      message: 'Malformed JSON request.',
      status: 400,
      cause,
    })
  }
}

function traceFilterFromUrl(url: URL): RuntimeTraceFilter {
  const value = (name: string) => url.searchParams.get(name) || undefined
  return {
    application: value('application'),
    environment: value('environment'),
    instanceId: value('instanceId'),
    eventLogId: value('eventLogId'),
  }
}

function filterFromUrl(url: URL): RuntimeActivityFilter {
  const value = (name: string) => url.searchParams.get(name) || undefined
  const after = Number(url.searchParams.get('afterCollectorOrder') ?? 0)
  const afterSequenceValue = url.searchParams.get('afterSequence')
  const afterSequence =
    afterSequenceValue === null ? undefined : Number(afterSequenceValue)
  const limit = Number(url.searchParams.get('limit') ?? 100)
  return {
    application: value('application'),
    environment: value('environment'),
    instanceId: value('instanceId'),
    eventLogId: value('eventLogId'),
    kind: value('kind'),
    operationId: value('operationId'),
    correlationId: value('correlationId'),
    slice: value('slice'),
    reaction: value('reaction'),
    afterSequence:
      afterSequence !== undefined &&
      Number.isSafeInteger(afterSequence) &&
      afterSequence >= 0
        ? afterSequence
        : undefined,
    afterCollectorOrder: Number.isSafeInteger(after) && after >= 0 ? after : 0,
    limit:
      Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 500) : 100,
  }
}

function streamActivity(
  collector: SpecterObservabilityCollector,
  filter: RuntimeActivityFilter,
  signal: AbortSignal,
) {
  const encoder = new TextEncoder()
  const abortController = new AbortController()
  const abort = () => abortController.abort(signal.reason)
  if (signal.aborted) abort()
  else signal.addEventListener('abort', abort, { once: true })
  const iterator = collector
    .subscribeActivity(filter, { signal: abortController.signal })
    [Symbol.asyncIterator]()
  let afterCollectorOrder = filter.afterCollectorOrder ?? 0

  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await iterator.next()
          if (next.done) {
            signal.removeEventListener('abort', abort)
            controller.close()
            return
          }
          const fresh = next.value.filter(
            (item) => item.collectorOrder > afterCollectorOrder,
          )
          if (!fresh.length) return
          afterCollectorOrder =
            fresh.at(-1)?.collectorOrder ?? afterCollectorOrder
          controller.enqueue(
            encoder.encode(
              fresh
                .map(
                  (item) =>
                    `event: activity\ndata: ${JSON.stringify(item)}\n\n`,
                )
                .join(''),
            ),
          )
        } catch (cause) {
          const error = structuredProtocolError(cause)
          controller.enqueue(
            encoder.encode(
              `event: error\ndata: ${JSON.stringify({ error })}\n\n`,
            ),
          )
          controller.close()
        }
      },
      async cancel(reason) {
        abortController.abort(reason)
        signal.removeEventListener('abort', abort)
        await iterator.return?.()
      },
    }),
    {
      headers: {
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'content-type': 'text/event-stream; charset=utf-8',
        'x-accel-buffering': 'no',
      },
    },
  )
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  protocol = false,
) {
  return Response.json(
    { error: { code, message } },
    {
      status,
      headers: protocol ? { 'Specter-Protocol-Version': '1' } : undefined,
    },
  )
}
