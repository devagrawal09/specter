import {
  ReactionRunFailure,
  SpecterError,
  specterErrorCodes,
  type CommandExecutionOptions,
  type SpecterApp,
  type SpecterAppConfig,
  type SpecterCommandEnvelope,
  type SpecterQueryEnvelope,
} from '@specter-ts/core'

import {
  assertJsonCompatible,
  isRecord,
  type JsonValue,
  type SpecterWireError,
} from './specter-protocol'

type RunInContext = <T>(operation: () => Promise<T>) => Promise<T>

export type SpecterHttpHandlerOptions<TConfig extends SpecterAppConfig> = {
  readonly app: SpecterApp<TConfig>
  readonly basePath: string
  readonly run?: RunInContext
  readonly reactionRetentionMs?: number
  readonly reactionTickets?: SpecterReactionTicketStore
}

export type SettledReaction =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: SerializedError }

export type SerializedError = {
  readonly status: number
  readonly body: SpecterWireError
}

export type SpecterReactionRecovery = {
  readonly envelope: unknown
  readonly options: CommandExecutionOptions
}

export type SpecterReactionTicket =
  | {
      readonly status: 'pending'
      readonly recovery: SpecterReactionRecovery
    }
  | {
      readonly status: 'settled'
      readonly result: SettledReaction
    }

export type SpecterReactionTicketStore = {
  create(
    reactionId: string,
    expiresAt: Date,
    recovery: SpecterReactionRecovery,
  ): Promise<void>
  settle(reactionId: string, result: SettledReaction): Promise<void>
  get(reactionId: string): Promise<SpecterReactionTicket | undefined>
}

export function createMemoryReactionTicketStore(): SpecterReactionTicketStore {
  type Ticket = {
    result?: SettledReaction
    expiresAt: number
    recovery: SpecterReactionRecovery
  }
  const tickets = new Map<string, Ticket>()

  const prune = () => {
    const now = Date.now()
    for (const [reactionId, ticket] of tickets) {
      if (ticket.expiresAt <= now) tickets.delete(reactionId)
    }
  }

  return {
    async create(reactionId, expiresAt, recovery) {
      prune()
      tickets.set(reactionId, {
        expiresAt: expiresAt.getTime(),
        recovery,
      })
    },
    async settle(reactionId, result) {
      const ticket = tickets.get(reactionId)
      if (!ticket) return
      ticket.result = result
    },
    async get(reactionId) {
      prune()
      const ticket = tickets.get(reactionId)
      if (!ticket) return undefined
      return ticket.result
        ? { status: 'settled', result: ticket.result }
        : { status: 'pending', recovery: ticket.recovery }
    },
  }
}

export function createSpecterHttpHandler<TConfig extends SpecterAppConfig>(
  options: SpecterHttpHandlerOptions<TConfig>,
) {
  const basePath = `/${options.basePath.replace(/^\/+|\/+$/g, '')}`
  const run: RunInContext = options.run ?? ((operation) => operation())
  const reactionRetentionMs = options.reactionRetentionMs ?? 5 * 60_000
  const reactionTickets =
    options.reactionTickets ?? createMemoryReactionTicketStore()

  return async function handleSpecterHttpRequest(request: Request) {
    const url = new URL(request.url)
    const route = url.pathname.slice(basePath.length) || '/'

    if (!url.pathname.startsWith(`${basePath}/`)) {
      return errorResponse(404, 'SPECTER_ROUTE_NOT_FOUND', 'Route not found.')
    }

    try {
      if (request.method === 'POST' && route === '/command') {
        return await handleCommand(request)
      }
      if (request.method === 'POST' && route === '/query') {
        return await handleQuery(request)
      }
      if (request.method === 'POST' && route === '/subscribe') {
        return await handleSubscription(request)
      }
      if (request.method === 'GET' && route.startsWith('/reactions/')) {
        return await handleReaction(route.slice('/reactions/'.length))
      }

      return errorResponse(404, 'SPECTER_ROUTE_NOT_FOUND', 'Route not found.')
    } catch (cause) {
      return serializedErrorResponse(serializeError(cause))
    }
  }

  async function handleCommand(request: Request) {
    const body = await readJsonBody(request)
    const envelope = body.envelope
    const requestedCommandOptions = body.options ?? {}
    assertJsonCompatible(envelope)
    assertJsonCompatible(requestedCommandOptions)

    const reactionId = crypto.randomUUID()
    const commandOptions = {
      ...(requestedCommandOptions as CommandExecutionOptions),
      idempotencyKey:
        (requestedCommandOptions as CommandExecutionOptions).idempotencyKey ??
        reactionId,
    }
    await reactionTickets.create(
      reactionId,
      new Date(Date.now() + reactionRetentionMs),
      { envelope, options: commandOptions },
    )

    const execution = await run(() =>
      options.app.command(
        envelope as SpecterCommandEnvelope<TConfig>,
        commandOptions,
      ),
    )

    trackReactionCompletion(reactionId, execution.reactions)

    const response = {
      events: execution.events,
      version: execution.version,
      duplicate: execution.duplicate,
      reactionId,
    }
    assertJsonCompatible(response)
    return Response.json(response)
  }

  async function handleQuery(request: Request) {
    const body = await readJsonBody(request)
    assertJsonCompatible(body.envelope)
    const result = await run(() =>
      options.app.query(body.envelope as SpecterQueryEnvelope<TConfig>),
    )
    assertJsonCompatible(result)
    return Response.json(result)
  }

  async function handleSubscription(request: Request) {
    const body = await readJsonBody(request)
    assertJsonCompatible(body.envelope)

    const abortController = new AbortController()

    const iterator = await run(async () =>
      options.app
        .subscribe(body.envelope as SpecterQueryEnvelope<TConfig>, {
          signal: abortController.signal,
        })
        [Symbol.asyncIterator](),
    )
    const encoder = new TextEncoder()
    let cleanedUp = false

    const cleanup = async (reason?: unknown) => {
      if (cleanedUp) return
      cleanedUp = true
      abortController.abort(reason)
      request.signal.removeEventListener('abort', abort)
      await run(async () => {
        await iterator.return?.()
      }).catch(() => undefined)
    }
    const abort = () => {
      void cleanup(request.signal.reason)
    }
    if (request.signal.aborted) abort()
    else request.signal.addEventListener('abort', abort, { once: true })

    return new Response(
      new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const next = await run(() => iterator.next())
            if (next.done) {
              await cleanup()
              controller.close()
              return
            }
            assertJsonCompatible(next.value)
            controller.enqueue(
              encoder.encode(
                `event: value\ndata: ${JSON.stringify(next.value)}\n\n`,
              ),
            )
          } catch (cause) {
            const serialized = serializeError(cause)
            controller.enqueue(
              encoder.encode(
                `event: error\ndata: ${JSON.stringify(serialized.body)}\n\n`,
              ),
            )
            await cleanup(cause)
            controller.close()
          }
        },
        async cancel(reason) {
          await cleanup(reason)
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

  async function handleReaction(encodedReactionId: string) {
    const reactionId = decodeURIComponent(encodedReactionId)
    const ticket = await reactionTickets.get(reactionId)
    if (!ticket) {
      return errorResponse(
        404,
        'SPECTER_REACTION_TICKET_NOT_FOUND',
        'Reaction completion ticket was not found or has expired.',
      )
    }

    let result: SettledReaction
    if (ticket.status === 'settled') {
      result = ticket.result
    } else {
      const execution = await run(() =>
        options.app.command(
          ticket.recovery.envelope as SpecterCommandEnvelope<TConfig>,
          ticket.recovery.options,
        ),
      )
      result = await settleReaction(execution.reactions)
      await reactionTickets.settle(reactionId, result)
    }

    if (result.ok) return new Response(null, { status: 204 })
    return serializedErrorResponse(result.error)
  }

  function trackReactionCompletion(
    reactionId: string,
    reactions: Promise<void>,
  ) {
    void settleReaction(reactions)
      .then((result) => reactionTickets.settle(reactionId, result))
      .catch(() => {
        // A durable pending ticket is intentionally recoverable on the next GET.
      })
  }
}

function settleReaction(reactions: Promise<void>) {
  return reactions.then<SettledReaction, SettledReaction>(
    () => ({ ok: true }),
    (cause) => ({ ok: false, error: serializeError(cause) }),
  )
}

async function readJsonBody(request: Request) {
  let value: unknown
  try {
    value = await request.json()
  } catch (cause) {
    throw new SpecterTransportInputError(
      'Request body must be valid JSON.',
      cause,
    )
  }

  if (!isRecord(value)) {
    throw new SpecterTransportInputError('Request body must be a JSON object.')
  }
  return value
}

class SpecterTransportInputError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'SpecterTransportInputError'
  }
}

function serializeError(cause: unknown): SerializedError {
  if (cause instanceof ReactionRunFailure) {
    return {
      status: 502,
      body: {
        error: {
          code: cause.code,
          message: cause.message,
          details: {
            failedSlices: cause.failures.map(({ sliceName }) => sliceName),
          },
        },
      },
    }
  }

  if (cause instanceof SpecterError) {
    return {
      status: statusForCode(cause.code),
      body: {
        error: {
          code: cause.code,
          message: cause.message,
          details: publicDetails(cause),
        },
      },
    }
  }

  if (
    cause instanceof SpecterTransportInputError ||
    cause instanceof TypeError
  ) {
    return {
      status: 400,
      body: {
        error: {
          code: 'SPECTER_TRANSPORT_INVALID_JSON',
          message: cause.message,
        },
      },
    }
  }

  return {
    status: 500,
    body: {
      error: {
        code: specterErrorCodes.infrastructureFailure,
        message: 'Unexpected Specter infrastructure failure.',
      },
    },
  }
}

function publicDetails(error: SpecterError): JsonValue | undefined {
  const candidate = error as SpecterError & Record<string, unknown>
  const details: Record<string, JsonValue> = {}

  for (const key of [
    'commandType',
    'queryType',
    'operationKind',
    'operationType',
    'expectedVersion',
    'actualVersion',
    'idempotencyKey',
    'afterOrder',
    'receivedOrders',
  ]) {
    const value = candidate[key]
    try {
      assertJsonCompatible(value)
      details[key] = value
    } catch {
      // Causes and other non-JSON internals never cross the transport boundary.
    }
  }

  return Object.keys(details).length > 0 ? details : undefined
}

function statusForCode(code: string) {
  switch (code) {
    case specterErrorCodes.unknownCommand:
    case specterErrorCodes.unknownQuery:
      return 404
    case specterErrorCodes.commandRejected:
    case specterErrorCodes.idempotencyConflict:
    case specterErrorCodes.versionConflict:
      return 409
    case specterErrorCodes.infrastructureFailure:
      return 500
    default:
      return 400
  }
}

function errorResponse(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status })
}

function serializedErrorResponse(error: SerializedError) {
  return Response.json(error.body, { status: error.status })
}
