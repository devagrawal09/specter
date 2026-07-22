export const SPECTER_PROTOCOL_VERSION = 1 as const

export type JsonPrimitive = string | number | boolean | null
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

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
  readonly deliveryId?: string
}

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
  | RuntimeObservationBatch
  | RuntimeObservationAcknowledgement
