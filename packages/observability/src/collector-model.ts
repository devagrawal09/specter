import type { RuntimeObservation, RuntimeSource } from '@specter-ts/protocol'

export type CollectedRuntimeObservation = RuntimeObservation & {
  readonly collectorOrder: number
}

export type RuntimeActivityFilter = {
  readonly application?: string
  readonly environment?: string
  readonly runtimeLanguage?: string
  readonly runtimeVersion?: string
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
  | 'application'
  | 'environment'
  | 'runtimeLanguage'
  | 'runtimeVersion'
  | 'instanceId'
  | 'eventLogId'
>

export type RuntimeExecutionSummary = {
  readonly executions: number
  readonly failures: number
  readonly rejections: number
}

export type RuntimeSourceSummary = {
  readonly source: RuntimeSource
  readonly observationCount: number
  readonly failureCount: number
  readonly rejectionCount: number
  readonly droppedObservationCount: number
  readonly lastSequence: number
  readonly lastObservedAt: string
  readonly projectionLag: number
  readonly executionsBySpecification: Readonly<
    Record<string, RuntimeExecutionSummary>
  >
}

export type RuntimeOverview = {
  readonly generatedAt: string
  readonly collectorVersion: number
  readonly observationCount: number
  readonly failureCount: number
  readonly rejectionCount: number
  readonly droppedObservationCount: number
  readonly sources: readonly RuntimeSourceSummary[]
  readonly kinds: Readonly<Record<string, number>>
  readonly recent: readonly CollectedRuntimeObservation[]
}

export type RuntimeTraceEdge = {
  readonly from: string
  readonly to: string
  readonly relation: 'parent-operation' | 'caused-by-event' | 'delivery'
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

const terminalKinds = new Set<RuntimeObservation['kind']>([
  'command.completed',
  'command.rejected',
  'command.failed',
  'query.completed',
  'query.rejected',
  'query.failed',
  'reaction.run.completed',
  'reaction.run.failed',
])

export function runtimeExecutionIdentity(observation: RuntimeObservation) {
  const executionIdentity =
    observation.kind.startsWith('reaction.run.') && observation.deliveryId
      ? `reaction:${observation.deliveryId}`
      : `operation:${observation.operationId}`
  return `${runtimeSourceIdentity(observation.source)}\u0000${executionIdentity}`
}

export function summarizeRuntimeExecutions(
  observations: readonly RuntimeObservation[],
): RuntimeExecutionSummary {
  const terminalByOperation = new Map<string, RuntimeObservation>()
  for (const observation of observations) {
    if (!terminalKinds.has(observation.kind)) continue
    terminalByOperation.set(runtimeExecutionIdentity(observation), observation)
  }
  const terminal = [...terminalByOperation.values()]
  return {
    executions: terminal.length,
    failures: terminal.filter((observation) => observation.outcome === 'failed')
      .length,
    rejections: terminal.filter(
      (observation) => observation.outcome === 'rejected',
    ).length,
  }
}
