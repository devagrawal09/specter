import type {
  RuntimeObservation,
  RuntimeObservationBatch,
  RuntimeSource,
} from '@specter-ts/protocol'

export type RuntimeObservationProducerOptions = {
  readonly endpoint: string
  readonly source: RuntimeSource
  readonly fetch?: typeof globalThis.fetch
  readonly idFactory?: () => string
  readonly now?: () => Date
  readonly maxQueuedObservations?: number
  readonly maxBatchSize?: number
  readonly retryDelayMs?: number
  readonly maxRetryDelayMs?: number
}

export type RuntimeObservationProducer = {
  record(observation: RuntimeObservation): void
  flush(): Promise<void>
  close(): Promise<void>
  inspect(): {
    readonly queued: number
    readonly dropped: number
    readonly closed: boolean
  }
}

export function createRuntimeObservationProducer(
  options: RuntimeObservationProducerOptions,
): RuntimeObservationProducer {
  const fetchImplementation = options.fetch ?? globalThis.fetch
  const idFactory = options.idFactory ?? (() => crypto.randomUUID())
  const now = options.now ?? (() => new Date())
  const capacity = options.maxQueuedObservations ?? 10_000
  const batchSize = Math.min(options.maxBatchSize ?? 100, 100)
  const initialRetryDelay = options.retryDelayMs ?? 100
  const maxRetryDelay = options.maxRetryDelayMs ?? 5_000
  const queue: RuntimeObservation[] = []
  let dropped = 0
  let reportedDropped = 0
  let activeFlush: Promise<void> | undefined
  let retryDelay = initialRetryDelay
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let closed = false
  let telemetrySequence = 0
  let pendingRequestId: string | undefined

  function record(observation: RuntimeObservation) {
    if (closed) return
    telemetrySequence = Math.max(telemetrySequence, observation.sequence)
    while (queue.length >= capacity) {
      queue.shift()
      dropped += 1
    }
    queue.push(structuredClone(observation))
    scheduleFlush()
  }

  function scheduleFlush() {
    if (activeFlush || retryTimer || queue.length === 0) return
    queueMicrotask(() => {
      if (!activeFlush && !retryTimer && queue.length > 0) {
        activeFlush = drain().finally(() => {
          activeFlush = undefined
          if (queue.length > 0 && !retryTimer) scheduleFlush()
        })
      }
    })
  }

  function droppedObservation(count: number): RuntimeObservation {
    telemetrySequence += 1
    const operationId = `telemetry-loss-${idFactory()}`
    return {
      observationId: idFactory(),
      sequence: telemetrySequence,
      observedAt: now().toISOString(),
      source: options.source,
      kind: 'telemetry.dropped',
      operationId,
      outcome: 'failed',
      droppedCount: count,
    }
  }

  async function drain() {
    while (queue.length > 0) {
      const droppedToReport = dropped - reportedDropped
      const observations = queue.slice(
        0,
        Math.max(1, batchSize - (droppedToReport ? 1 : 0)),
      )
      if (droppedToReport > 0)
        observations.unshift(droppedObservation(droppedToReport))
      const requestId = pendingRequestId ?? idFactory()
      pendingRequestId = requestId
      const batch: RuntimeObservationBatch = {
        protocolVersion: 1,
        kind: 'observations.batch',
        requestId,
        observations,
      }

      try {
        const response = await fetchImplementation(
          `${options.endpoint.replace(/\/$/, '')}/specter/v1/observations`,
          {
            method: 'POST',
            headers: {
              accept: 'application/json',
              'content-type': 'application/json',
            },
            body: JSON.stringify(batch),
          },
        )
        if (!response.ok)
          throw new Error(`Collector returned HTTP ${response.status}`)
        queue.splice(0, observations.length - (droppedToReport ? 1 : 0))
        if (droppedToReport) reportedDropped += droppedToReport
        pendingRequestId = undefined
        retryDelay = initialRetryDelay
      } catch {
        retryTimer = setTimeout(() => {
          retryTimer = undefined
          scheduleFlush()
        }, retryDelay)
        retryDelay = Math.min(maxRetryDelay, retryDelay * 2)
        return
      }
    }
  }

  async function flush() {
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = undefined
    }
    if (!activeFlush && queue.length > 0) activeFlush = drain()
    const currentFlush = activeFlush
    await currentFlush
    if (activeFlush === currentFlush) activeFlush = undefined
  }

  async function close() {
    closed = true
    await flush()
  }

  return {
    record,
    flush,
    close,
    inspect: () => ({ queued: queue.length, dropped, closed }),
  }
}
