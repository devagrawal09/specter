import type { RuntimeObservation } from '@specter-ts/protocol'
import { describe, expect, it } from 'vitest'

import { executionSummary } from './dashboard-model'

const source = {
  application: 'todo',
  environment: 'test',
  runtimeLanguage: 'typescript',
  runtimeVersion: '0.4.0',
  instanceId: 'instance-1',
  eventLogId: 'log-1',
}

function observation(
  kind: RuntimeObservation['kind'],
  operationId: string,
  outcome?: RuntimeObservation['outcome'],
  deliveryId?: string,
): RuntimeObservation {
  return {
    observationId: `${operationId}:${kind}`,
    sequence: 1,
    observedAt: '2026-07-22T12:00:00.000Z',
    source,
    kind,
    operationId,
    ...(outcome ? { outcome } : {}),
    ...(deliveryId ? { deliveryId } : {}),
  }
}

describe('dashboard execution summary', () => {
  it('counts terminal operations instead of every lifecycle observation', () => {
    const observations = [
      observation('command.started', 'command-1'),
      observation('events.persisted', 'command-1', 'succeeded'),
      observation('command.completed', 'command-1', 'succeeded'),
      observation('query.started', 'query-1'),
      observation('query.failed', 'query-1', 'failed'),
      observation('reaction.run.started', 'reaction-1'),
    ]

    expect(executionSummary(observations)).toEqual({
      executions: 2,
      failures: 1,
    })
  })

  it('counts retries of one Reaction delivery as one execution', () => {
    const observations = [
      observation(
        'reaction.run.failed',
        'reaction-attempt-1',
        'failed',
        'publishValue:4',
      ),
      observation(
        'reaction.run.completed',
        'reaction-attempt-2',
        'succeeded',
        'publishValue:4',
      ),
    ]

    expect(executionSummary(observations)).toEqual({
      executions: 1,
      failures: 0,
    })
  })
})
