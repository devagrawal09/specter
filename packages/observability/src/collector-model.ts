import type { RuntimeObservation, RuntimeSource } from '@specter-ts/protocol'

export type CollectedRuntimeObservation = RuntimeObservation & {
  readonly collectorOrder: number
}

export type RuntimeActivityFilter = {
  readonly application?: string
  readonly environment?: string
  readonly instanceId?: string
  readonly eventLogId?: string
  readonly kind?: string
  readonly operationId?: string
  readonly correlationId?: string
  readonly slice?: string
  readonly reaction?: string
  readonly afterSequence?: number
  readonly afterCollectorOrder?: number
  readonly limit?: number
}

export type RuntimeTraceFilter = Pick<
  RuntimeActivityFilter,
  'application' | 'environment' | 'instanceId' | 'eventLogId'
>

export type RuntimeSourceSummary = {
  readonly source: RuntimeSource
  readonly observationCount: number
  readonly failureCount: number
  readonly lastSequence: number
  readonly lastObservedAt: string
  readonly projectionLag: number
}

export type RuntimeOverview = {
  readonly generatedAt: string
  readonly collectorVersion: number
  readonly observationCount: number
  readonly failureCount: number
  readonly droppedObservationCount: number
  readonly sources: readonly RuntimeSourceSummary[]
  readonly kinds: Readonly<Record<string, number>>
  readonly recent: readonly CollectedRuntimeObservation[]
}

export type RuntimeTraceEdge = {
  readonly from: string
  readonly to: string
  readonly relation:
    | 'parent-operation'
    | 'caused-by-event'
    | 'reaction-pass'
    | 'delivery'
    | 'attempt'
}

export type RuntimeTrace = {
  readonly operationId: string
  readonly observations: readonly CollectedRuntimeObservation[]
  readonly edges: readonly RuntimeTraceEdge[]
}

export type CollectorState = {
  observations: CollectedRuntimeObservation[]
  observationIds: Record<string, true>
}

export function createCollectorState(): CollectorState {
  return { observations: [], observationIds: {} }
}

export function copyCollectorState(state: CollectorState): CollectorState {
  return {
    observations: structuredClone(state.observations),
    observationIds: { ...state.observationIds },
  }
}

export function runtimeObservationIdentity(
  observation: Pick<RuntimeObservation, 'source' | 'observationId'>,
) {
  return [
    runtimeSourceIdentity(observation.source),
    observation.observationId,
  ].join('\u0000')
}

export function runtimeSourceIdentity(source: RuntimeSource) {
  return [
    source.application,
    source.environment,
    source.runtimeLanguage,
    source.runtimeVersion,
    source.instanceId,
    source.eventLogId,
  ].join('\u0000')
}

export function runtimeEventLogIdentity(source: RuntimeSource) {
  return [source.application, source.environment, source.eventLogId].join(
    '\u0000',
  )
}
