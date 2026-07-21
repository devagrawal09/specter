export const SPECTER_PROTOCOL_VERSION = 1 as const

export type JsonPrimitive = string | number | boolean | null
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

export const protocolCapabilities = [
  'commands',
  'queries',
  'query-subscriptions',
  'reaction-tickets',
  'runtime-observations',
] as const

export type ProtocolCapability = (typeof protocolCapabilities)[number] | string

export type ProtocolEnvelope<TKind extends string> = {
  readonly protocolVersion: typeof SPECTER_PROTOCOL_VERSION
  readonly kind: TKind
  readonly requestId: string
}

export type StructuredError = {
  readonly code: string
  readonly message: string
  readonly details?: JsonValue
  readonly retryable?: boolean
}

export type CapabilitiesRequest = ProtocolEnvelope<'capabilities.request'> & {
  readonly required?: readonly ProtocolCapability[]
  readonly optional?: readonly ProtocolCapability[]
}

export type CapabilitiesResponse = ProtocolEnvelope<'capabilities.response'> & {
  readonly runtime: {
    readonly language: string
    readonly version: string
  }
  readonly supported: readonly ProtocolCapability[]
  readonly negotiated: readonly ProtocolCapability[]
}

export type EventReference = {
  readonly eventId: string
  readonly type: string
  readonly order: number
  readonly recordedAt: string
  readonly commitVersion: number
  readonly attributes?: Readonly<Record<string, JsonValue>>
}

export type Causality = {
  readonly operationId: string
  readonly correlationId?: string
  readonly parentOperationIds?: readonly string[]
  readonly triggeringEventIds?: readonly string[]
  readonly triggeringEventOrder?: {
    readonly from: number
    readonly to: number
  }
  readonly reactionPassId?: string
  readonly deliveryId?: string
  readonly attemptId?: string
}

export type CommandRequest = ProtocolEnvelope<'command.request'> &
  Causality & {
    readonly command: { readonly type: string; readonly payload: JsonValue }
    readonly idempotencyKey?: string
    readonly expectedVersion?: number
  }

type CommandResponseBase = {
  readonly operationId: string
  readonly version: number
  readonly events: readonly EventReference[]
  readonly reactionTicketId?: string
}

export type CommandResponseResult = CommandResponseBase &
  (
    | {
        readonly status: 'committed' | 'duplicate'
        readonly error?: never
      }
    | { readonly status: 'rejected'; readonly error: StructuredError }
  )

export type CommandResponse = ProtocolEnvelope<'command.response'> &
  CommandResponseResult

export type QueryRequest = ProtocolEnvelope<'query.request'> &
  Causality & {
    readonly query: { readonly type: string; readonly payload: JsonValue }
  }

export type QueryResponseResult = { readonly operationId: string } & (
  | { readonly result: JsonValue; readonly error?: never }
  | { readonly result?: never; readonly error: StructuredError }
)

export type QueryResponse = ProtocolEnvelope<'query.response'> &
  QueryResponseResult

export type SubscriptionRequest = ProtocolEnvelope<'subscription.request'> &
  Causality & {
    readonly query: { readonly type: string; readonly payload: JsonValue }
    readonly afterSequence?: number
  }

export type SubscriptionValue = ProtocolEnvelope<'subscription.value'> & {
  readonly operationId: string
  readonly sequence: number
  readonly result: JsonValue
}

export type SubscriptionError = ProtocolEnvelope<'subscription.error'> & {
  readonly operationId: string
  readonly error: StructuredError
}

export type SubscriptionComplete = ProtocolEnvelope<'subscription.complete'> & {
  readonly operationId: string
}

export type SubscriptionMessage =
  | SubscriptionValue
  | SubscriptionError
  | SubscriptionComplete

export type ReactionTicketRequest =
  ProtocolEnvelope<'reaction-ticket.request'> & {
    readonly reactionTicketId: string
  }

export type ReactionTicketResult =
  | { readonly status: 'pending' | 'completed'; readonly error?: never }
  | { readonly status: 'failed'; readonly error: StructuredError }

export type ReactionTicketResponse =
  ProtocolEnvelope<'reaction-ticket.response'> & {
    readonly reactionTicketId: string
  } & ReactionTicketResult

export type RuntimeSource = {
  readonly application: string
  readonly environment: string
  readonly runtimeLanguage: string
  readonly runtimeVersion: string
  readonly instanceId: string
  readonly eventLogId: string
}

export const observationKinds = [
  'command.started',
  'command.completed',
  'command.rejected',
  'command.failed',
  'query.started',
  'query.completed',
  'query.rejected',
  'query.failed',
  'events.persisted',
  'slice.catch-up.started',
  'slice.catch-up.completed',
  'slice.catch-up.failed',
  'subscription.invalidated',
  'replay.started',
  'replay.completed',
  'replay.failed',
  'reaction.pass.started',
  'reaction.pass.completed',
  'reaction.pass.failed',
  'reaction.run.started',
  'reaction.run.completed',
  'reaction.run.failed',
  'outbox.enqueued',
  'outbox.attempted',
  'outbox.retry-scheduled',
  'outbox.dead-lettered',
  'telemetry.dropped',
] as const

export type ObservationKind = (typeof observationKinds)[number]

export type RuntimeObservation = Causality & {
  readonly observationId: string
  readonly sequence: number
  readonly observedAt: string
  readonly source: RuntimeSource
  readonly kind: ObservationKind
  readonly outcome?: 'succeeded' | 'rejected' | 'failed'
  readonly commandType?: string
  readonly queryType?: string
  readonly slice?: string
  readonly reaction?: string
  readonly events?: readonly EventReference[]
  readonly cursor?: number
  readonly error?: StructuredError
  readonly droppedCount?: number
  readonly attributes?: Readonly<Record<string, JsonValue>>
}

export type RuntimeObservationBatch = ProtocolEnvelope<'observations.batch'> & {
  readonly observations: readonly RuntimeObservation[]
}

export type RuntimeObservationAcknowledgement =
  ProtocolEnvelope<'observations.ack'> & {
    readonly accepted: number
    readonly duplicates: number
    readonly rejectedObservationIds?: readonly string[]
  }

export type ProtocolMessage =
  | CapabilitiesRequest
  | CapabilitiesResponse
  | CommandRequest
  | CommandResponse
  | QueryRequest
  | QueryResponse
  | SubscriptionRequest
  | SubscriptionMessage
  | ReactionTicketRequest
  | ReactionTicketResponse
  | RuntimeObservationBatch
  | RuntimeObservationAcknowledgement
