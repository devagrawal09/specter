import type {
  EventLogAdapter,
  SpecterApp,
  SpecterAppConfig,
  SpecterCommandEnvelope,
  SpecterQueryEnvelope,
} from '@specter-ts/core'

import type { ProtocolRuntimeAdapter } from './http-server'
import type {
  CommandRequest,
  EventReference,
  QueryRequest,
  SubscriptionRequest,
} from './types'
import { structuredProtocolError } from './errors'
import { assertJsonValue } from './validation'

export type SpecterRuntimeProtocolAdapterOptions<
  TConfig extends SpecterAppConfig,
> = {
  readonly app: SpecterApp<TConfig>
  readonly eventLog: EventLogAdapter
  readonly runtimeVersion: string
  readonly ticketRetentionMs?: number
  readonly run?: <T>(operation: () => Promise<T>) => Promise<T>
}

export function createSpecterRuntimeProtocolAdapter<
  TConfig extends SpecterAppConfig,
>(
  options: SpecterRuntimeProtocolAdapterOptions<TConfig>,
): ProtocolRuntimeAdapter {
  const tickets = new Map<string, Promise<void>>()
  const ticketRetentionMs = options.ticketRetentionMs ?? 5 * 60_000
  const run = options.run ?? ((operation) => operation())

  return {
    runtime: { language: 'typescript', version: options.runtimeVersion },
    capabilities: [
      'commands',
      'queries',
      'query-subscriptions',
      'reaction-tickets',
    ],
    async command(request: CommandRequest) {
      try {
        const execution = await run(() =>
          options.app.command(
            request.command as SpecterCommandEnvelope<TConfig>,
            {
              operationId: request.operationId,
              correlationId: request.correlationId,
              parentOperationIds: request.parentOperationIds,
              idempotencyKey: request.idempotencyKey,
              expectedVersion: request.expectedVersion,
            },
          ),
        )
        const reactionTicketId = request.idempotencyKey
          ? await stableReactionTicketId(request.idempotencyKey)
          : crypto.randomUUID()
        if (!execution.duplicate) {
          tickets.set(reactionTicketId, execution.reactions)
          setTimeout(() => tickets.delete(reactionTicketId), ticketRetentionMs)
        }
        return {
          operationId: execution.operationId ?? request.operationId,
          status: execution.duplicate ? 'duplicate' : 'committed',
          version: execution.version,
          events: execution.events.map(
            (event) =>
              ({
                eventId: event.id,
                type: event.type,
                order: event.order,
                recordedAt: event.recordedAt,
                commitVersion: execution.version,
              }) satisfies EventReference,
          ),
          reactionTicketId,
        }
      } catch (cause) {
        return {
          operationId: request.operationId,
          status: 'rejected',
          version: await options.eventLog.currentVersion(),
          events: [],
          error: structuredProtocolError(cause),
        }
      }
    },
    async query(request: QueryRequest) {
      const result = await run(() =>
        options.app.query(request.query as SpecterQueryEnvelope<TConfig>, {
          operationId: request.operationId,
          correlationId: request.correlationId,
          parentOperationIds: request.parentOperationIds,
        }),
      )
      assertJsonValue(result)
      return result
    },
    subscribe(request: SubscriptionRequest, subscriptionOptions) {
      const values = options.app.subscribe(
        request.query as SpecterQueryEnvelope<TConfig>,
        {
          signal: subscriptionOptions.signal,
          operationId: request.operationId,
          correlationId: request.correlationId,
          parentOperationIds: request.parentOperationIds,
        },
      )
      return sequenceValues(values, run)
    },
    async reactionTicket(reactionTicketId) {
      const ticket = tickets.get(reactionTicketId)
      if (!ticket) {
        return {
          status: 'failed',
          error: {
            code: 'SPECTER_REACTION_TICKET_NOT_FOUND',
            message: 'Reaction ticket was not found or expired.',
          },
        }
      }
      const pending = Symbol('pending')
      const result = await Promise.race([
        ticket.then(
          () => ({ status: 'completed' as const }),
          (cause) => ({
            status: 'failed' as const,
            error: structuredProtocolError(cause),
          }),
        ),
        Promise.resolve(pending),
      ])
      return result === pending ? { status: 'pending' } : result
    },
    async ingestObservations() {
      throw new Error('This runtime does not accept observation batches.')
    },
  }
}

async function* sequenceValues(
  values: AsyncIterable<unknown>,
  run: <T>(operation: () => Promise<T>) => Promise<T>,
) {
  let sequence = 0
  const iterator = values[Symbol.asyncIterator]()
  try {
    for (;;) {
      const next = await run(() => iterator.next())
      if (next.done) return
      assertJsonValue(next.value)
      yield { sequence: ++sequence, result: next.value }
    }
  } finally {
    await run(async () => {
      await iterator.return?.()
    })
  }
}

async function stableReactionTicketId(idempotencyKey: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(idempotencyKey),
  )
  return `reaction-${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`
}
