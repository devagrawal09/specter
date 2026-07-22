import type { RuntimeObservation } from '@specter-ts/protocol'

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
} {
  const terminalByOperation = new Map<string, RuntimeObservation>()
  for (const observation of observations) {
    if (!terminalKinds.has(observation.kind)) continue
    terminalByOperation.set(operationIdentity(observation), observation)
  }
  const terminal = [...terminalByOperation.values()]
  return {
    executions: terminal.length,
    failures: terminal.filter(
      (observation) =>
        observation.outcome === 'failed' || observation.outcome === 'rejected',
    ).length,
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
