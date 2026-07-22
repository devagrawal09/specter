import type { RuntimeObservation, RuntimeSource } from '@specter-ts/protocol'

import type { RuntimeOverview, RuntimeSourceSummary } from './collector-model'
import type { CollectedSpecification } from './specification-catalog'

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

export function executionSummary(observations: readonly RuntimeObservation[]): {
  readonly executions: number
  readonly failures: number
  readonly rejections: number
} {
  const terminalByOperation = new Map<string, RuntimeObservation>()
  for (const observation of observations) {
    if (!terminalKinds.has(observation.kind)) continue
    terminalByOperation.set(operationIdentity(observation), observation)
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

export type RuntimeScope = {
  readonly application: string
  readonly environment: string
  readonly source?: string
}

export type RuntimeScopeSummary = {
  readonly observations: number
  readonly failures: number
  readonly rejections: number
  readonly dropped: number
  readonly maxProjectionLag: number
  readonly lastObservedAt?: string
}

export type ApplicationRuntimeGroup = {
  readonly application: string
  readonly environment: string
  readonly specifications: readonly CollectedSpecification[]
  readonly sourceCount: number
  readonly summary: RuntimeScopeSummary
}

export function runtimeSourceIdentity(source: RuntimeSource): string {
  return [
    source.runtimeLanguage,
    source.runtimeVersion,
    source.instanceId,
    source.eventLogId,
  ].join('\u0000')
}

export function sourceMatchesScope(
  source: RuntimeSource,
  scope: RuntimeScope,
): boolean {
  return (
    source.application === scope.application &&
    source.environment === scope.environment &&
    (!scope.source || runtimeSourceIdentity(source) === scope.source)
  )
}

export function observationMatchesScope(
  observation: RuntimeObservation,
  scope: RuntimeScope,
  specificationDigest?: string,
): boolean {
  return (
    sourceMatchesScope(observation.source, scope) &&
    (!specificationDigest ||
      observation.specificationDigest === specificationDigest)
  )
}

export function summarizeRuntimeScope(
  overview: RuntimeOverview | undefined,
  scope: RuntimeScope,
): RuntimeScopeSummary {
  const sources =
    overview?.sources.filter((item) =>
      sourceMatchesScope(item.source, scope),
    ) ?? []
  return summarizeSources(sources)
}

export function applicationRuntimeGroups(
  specifications: readonly CollectedSpecification[],
  overview: RuntimeOverview | undefined,
): readonly ApplicationRuntimeGroup[] {
  const scopes = new Map<
    string,
    {
      application: string
      environment: string
      specifications: Map<string, CollectedSpecification>
      sources: Set<string>
    }
  >()
  const include = (source: RuntimeSource) => {
    const key = `${source.application}\u0000${source.environment}`
    const current = scopes.get(key) ?? {
      application: source.application,
      environment: source.environment,
      specifications: new Map(),
      sources: new Set(),
    }
    current.sources.add(runtimeSourceIdentity(source))
    scopes.set(key, current)
    return current
  }
  for (const specification of specifications)
    for (const source of specification.sources)
      include(source).specifications.set(specification.digest, specification)
  for (const source of overview?.sources ?? []) include(source.source)

  return [...scopes.values()]
    .map((group) => ({
      application: group.application,
      environment: group.environment,
      specifications: [...group.specifications.values()].sort((left, right) =>
        left.document.name.localeCompare(right.document.name),
      ),
      sourceCount: group.sources.size,
      summary: summarizeRuntimeScope(overview, {
        application: group.application,
        environment: group.environment,
      }),
    }))
    .sort(
      (left, right) =>
        left.application.localeCompare(right.application) ||
        left.environment.localeCompare(right.environment),
    )
}

function summarizeSources(
  sources: readonly RuntimeSourceSummary[],
): RuntimeScopeSummary {
  return {
    observations: sources.reduce(
      (total, source) => total + source.observationCount,
      0,
    ),
    failures: sources.reduce((total, source) => total + source.failureCount, 0),
    rejections: sources.reduce(
      (total, source) => total + source.rejectionCount,
      0,
    ),
    dropped: sources.reduce(
      (total, source) => total + source.droppedObservationCount,
      0,
    ),
    maxProjectionLag: Math.max(
      0,
      ...sources.map((source) => source.projectionLag),
    ),
    lastObservedAt: sources
      .map((source) => source.lastObservedAt)
      .sort()
      .at(-1),
  }
}

function operationIdentity(observation: RuntimeObservation) {
  const source = observation.source
  const executionIdentity =
    observation.kind.startsWith('reaction.run.') && observation.deliveryId
      ? `reaction:${observation.deliveryId}`
      : `operation:${observation.operationId}`
  return [
    source.application,
    source.environment,
    source.runtimeLanguage,
    source.runtimeVersion,
    source.instanceId,
    source.eventLogId,
    executionIdentity,
  ].join('\u0000')
}
