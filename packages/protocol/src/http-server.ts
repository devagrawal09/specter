import { negotiateCapabilities } from './capabilities'
import {
  protocolErrorCodes,
  SpecterProtocolError,
  structuredProtocolError,
} from './errors'
import { parseProtocolMessage } from './validation'
import type {
  CapabilitiesResponse,
  CommandRequest,
  CommandResponse,
  CommandResponseResult,
  JsonValue,
  ProtocolCapability,
  QueryRequest,
  QueryResponse,
  ReactionTicketResult,
  ReactionTicketResponse,
  RuntimeObservationAcknowledgement,
  RuntimeObservationBatch,
  SubscriptionMessage,
  SubscriptionRequest,
} from './types'
import { SPECTER_PROTOCOL_VERSION } from './types'

export type ProtocolRuntimeAdapter = {
  readonly runtime: { readonly language: string; readonly version: string }
  readonly capabilities: readonly ProtocolCapability[]
  command(request: CommandRequest): Promise<CommandResponseResult>
  query(request: QueryRequest): Promise<JsonValue>
  subscribe(
    request: SubscriptionRequest,
    options: { readonly signal: AbortSignal },
  ): AsyncIterable<{ readonly sequence: number; readonly result: JsonValue }>
  reactionTicket(reactionTicketId: string): Promise<ReactionTicketResult>
  ingestObservations(
    batch: RuntimeObservationBatch,
  ): Promise<
    Omit<
      RuntimeObservationAcknowledgement,
      'protocolVersion' | 'kind' | 'requestId'
    >
  >
}

export type SpecterProtocolHttpHandlerOptions = {
  readonly runtime: ProtocolRuntimeAdapter
  readonly basePath?: string
}

export function createSpecterProtocolHttpHandler(
  options: SpecterProtocolHttpHandlerOptions,
): (request: Request) => Promise<Response> {
  const basePath = normalizeBasePath(options.basePath ?? '/specter/v1')

  return async (request) => {
    const url = new URL(request.url)
    if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) {
      return errorResponse(
        new SpecterProtocolError({
          code: protocolErrorCodes.routeNotFound,
          message: 'Route not found.',
          status: 404,
        }),
      )
    }
    const route = url.pathname.slice(basePath.length) || '/'
    try {
      if (request.method === 'GET' && route === '/capabilities') {
        const requestId =
          url.searchParams.get('requestId') ?? crypto.randomUUID()
        return json(capabilitiesResponse(requestId, [], options.runtime))
      }
      if (request.method === 'POST' && route === '/capabilities') {
        const message = await readMessage(request)
        if (message.kind !== 'capabilities.request')
          return wrongKind('capabilities.request')
        return json(
          capabilitiesResponse(
            message.requestId,
            negotiateCapabilities(message, options.runtime.capabilities),
            options.runtime,
          ),
        )
      }
      if (request.method === 'POST' && route === '/commands') {
        const message = await readMessage(request)
        if (message.kind !== 'command.request')
          return wrongKind('command.request')
        const result = await options.runtime.command(message)
        return json({
          protocolVersion: SPECTER_PROTOCOL_VERSION,
          kind: 'command.response',
          requestId: message.requestId,
          ...result,
        } satisfies CommandResponse)
      }
      if (request.method === 'POST' && route === '/queries') {
        const message = await readMessage(request)
        if (message.kind !== 'query.request') return wrongKind('query.request')
        let response: QueryResponse
        try {
          const result = await options.runtime.query(message)
          response = {
            protocolVersion: SPECTER_PROTOCOL_VERSION,
            kind: 'query.response',
            requestId: message.requestId,
            operationId: message.operationId,
            result,
          }
        } catch (cause) {
          response = {
            protocolVersion: SPECTER_PROTOCOL_VERSION,
            kind: 'query.response',
            requestId: message.requestId,
            operationId: message.operationId,
            error: structuredProtocolError(cause),
          }
        }
        return json(response)
      }
      if (request.method === 'POST' && route === '/subscriptions') {
        const message = await readMessage(request)
        if (message.kind !== 'subscription.request')
          return wrongKind('subscription.request')
        try {
          return subscriptionResponse(request, message, options.runtime)
        } catch (cause) {
          return subscriptionSetupErrorResponse(message, cause)
        }
      }
      if (request.method === 'GET' && route.startsWith('/reaction-tickets/')) {
        const reactionTicketId = decodeURIComponent(
          route.slice('/reaction-tickets/'.length),
        )
        const result = await options.runtime.reactionTicket(reactionTicketId)
        return json({
          protocolVersion: SPECTER_PROTOCOL_VERSION,
          kind: 'reaction-ticket.response',
          requestId: url.searchParams.get('requestId') ?? crypto.randomUUID(),
          reactionTicketId,
          ...result,
        } satisfies ReactionTicketResponse)
      }
      if (request.method === 'POST' && route === '/observations') {
        const message = await readMessage(request)
        if (message.kind !== 'observations.batch')
          return wrongKind('observations.batch')
        const result = await options.runtime.ingestObservations(message)
        return json({
          protocolVersion: SPECTER_PROTOCOL_VERSION,
          kind: 'observations.ack',
          requestId: message.requestId,
          ...result,
        } satisfies RuntimeObservationAcknowledgement)
      }
      return errorResponse(
        new SpecterProtocolError({
          code: protocolErrorCodes.routeNotFound,
          message: 'Route not found.',
          status: 404,
        }),
      )
    } catch (cause) {
      return errorResponse(cause)
    }
  }
}

function capabilitiesResponse(
  requestId: string,
  negotiated: readonly ProtocolCapability[],
  runtime: ProtocolRuntimeAdapter,
): CapabilitiesResponse {
  return {
    protocolVersion: SPECTER_PROTOCOL_VERSION,
    kind: 'capabilities.response',
    requestId,
    runtime: runtime.runtime,
    supported: runtime.capabilities,
    negotiated,
  }
}

function subscriptionResponse(
  request: Request,
  message: SubscriptionRequest,
  runtime: ProtocolRuntimeAdapter,
) {
  const abortController = new AbortController()
  const abort = () => abortController.abort(request.signal.reason)
  if (request.signal.aborted) abort()
  else request.signal.addEventListener('abort', abort, { once: true })
  const iterator = runtime
    .subscribe(message, { signal: abortController.signal })
    [Symbol.asyncIterator]()
  const encoder = new TextEncoder()
  let closed = false
  const cleanup = async (reason?: unknown) => {
    if (closed) return
    closed = true
    abortController.abort(reason)
    request.signal.removeEventListener('abort', abort)
    await iterator.return?.()
  }
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await iterator.next()
          if (next.done) {
            controller.enqueue(
              sse(encoder, {
                protocolVersion: 1,
                kind: 'subscription.complete',
                requestId: message.requestId,
                operationId: message.operationId,
              }),
            )
            await cleanup()
            controller.close()
            return
          }
          controller.enqueue(
            sse(encoder, {
              protocolVersion: 1,
              kind: 'subscription.value',
              requestId: message.requestId,
              operationId: message.operationId,
              sequence: next.value.sequence,
              result: next.value.result,
            }),
          )
        } catch (cause) {
          controller.enqueue(
            sse(encoder, {
              protocolVersion: 1,
              kind: 'subscription.error',
              requestId: message.requestId,
              operationId: message.operationId,
              error: structuredProtocolError(cause),
            }),
          )
          await cleanup(cause)
          controller.close()
        }
      },
      cancel: cleanup,
    }),
    {
      headers: {
        'cache-control': 'no-cache, no-transform',
        'content-type': 'text/event-stream; charset=utf-8',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      },
    },
  )
}

function sse(encoder: TextEncoder, message: SubscriptionMessage) {
  return encoder.encode(
    `event: ${message.kind}\ndata: ${JSON.stringify(message)}\n\n`,
  )
}

async function readMessage(request: Request) {
  assertJsonContentType(request.headers.get('content-type'))
  let body: unknown
  try {
    body = await request.json()
  } catch (cause) {
    throw new SpecterProtocolError({
      code: protocolErrorCodes.invalidJson,
      message: 'Request body must be valid JSON.',
      cause,
    })
  }
  return parseProtocolMessage(body)
}

function assertJsonContentType(header: string | null) {
  const mediaType = header?.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json') {
    throw new SpecterProtocolError({
      code: protocolErrorCodes.invalidMessage,
      message: 'Content-Type must be application/json.',
      status: 415,
    })
  }
}

function subscriptionSetupErrorResponse(
  message: SubscriptionRequest,
  cause: unknown,
) {
  const status =
    cause instanceof SpecterProtocolError
      ? cause.status
      : cause instanceof Error &&
          'code' in cause &&
          cause.code === 'SPECTER_UNKNOWN_QUERY'
        ? 400
        : 500
  return json(
    {
      protocolVersion: SPECTER_PROTOCOL_VERSION,
      kind: 'subscription.error',
      requestId: message.requestId,
      operationId: message.operationId,
      error: structuredProtocolError(cause),
    } satisfies SubscriptionMessage,
    status,
  )
}

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { 'specter-protocol-version': '1' },
  })
}
function wrongKind(expected: string) {
  return errorResponse(
    new SpecterProtocolError({
      code: protocolErrorCodes.invalidMessage,
      message: `Expected ${expected}.`,
    }),
  )
}
function errorResponse(cause: unknown) {
  const status = cause instanceof SpecterProtocolError ? cause.status : 500
  return json({ error: structuredProtocolError(cause) }, status)
}
function normalizeBasePath(path: string) {
  const normalized = `/${path.replace(/^\/+|\/+$/g, '')}`
  return normalized === '/' ? '' : normalized
}
