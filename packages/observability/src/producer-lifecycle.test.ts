import type { RuntimeObservation, RuntimeSource } from '@specter-ts/protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createRuntimeObservationProducer } from './producer'

const source: RuntimeSource = {
  application: 'producer-test',
  environment: 'test',
  runtimeLanguage: 'typescript',
  runtimeVersion: 'test',
  instanceId: 'instance-1',
  eventLogId: 'event-log-1',
}

afterEach(() => vi.useRealTimers())

describe('runtime observation producer lifecycle', () => {
  it('makes one bounded final attempt and cancels retries when closed', async () => {
    vi.useFakeTimers()
    let attempts = 0
    const producer = createRuntimeObservationProducer({
      endpoint: 'http://collector.invalid',
      source,
      retryDelayMs: 1_000,
      maxRetryDelayMs: 1_000,
      closeTimeoutMs: 10,
      fetch: async () => {
        attempts += 1
        throw new Error('collector offline')
      },
    })
    producer.record(observation())

    await producer.flush()
    const attemptsBeforeClose = attempts
    await producer.close()

    expect(attempts).toBe(attemptsBeforeClose + 1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(attempts).toBe(attemptsBeforeClose + 1)
    expect(producer.inspect()).toMatchObject({ closed: true, queued: 1 })
  })
})

function observation(): RuntimeObservation {
  return {
    observationId: 'observation-1',
    sequence: 1,
    observedAt: '2026-07-18T12:00:00.000Z',
    source,
    kind: 'command.started',
    operationId: 'operation-1',
  }
}
