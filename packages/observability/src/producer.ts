import type {
  RuntimeObservation,
  RuntimeObservationAcknowledgement,
  RuntimeObservationBatch,
  RuntimeSource,
} from '@specter-ts/protocol'
import { parseProtocolMessage } from '@specter-ts/protocol'

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
  const capacity = boundedPositiveInteger(options.maxQueuedObservations, 10_000)
  const batchSize = boundedPositiveInteger(options.maxBatchSize, 100, 100)
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
  let pending:
    | {
        readonly batch: RuntimeObservationBatch
        readonly queuedObservationCount: number
        readonly droppedCount: number
      }
    | undefined

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
    if (activeFlush || retryTimer || !hasWork()) return
    queueMicrotask(() => {
      if (!activeFlush && !retryTimer && hasWork()) {
        activeFlush = drain().finally(() => {
          activeFlush = undefined
          if (hasWork() && !retryTimer) scheduleFlush()
        })
      }
    })
  }

  function hasWork() {
    return Boolean(pending) || queue.length > 0 || dropped > reportedDropped
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
    while (hasWork()) {
      if (!pending) {
        const droppedToReport = dropped - reportedDropped
        const queuedObservationCount = Math.min(queue.length, batchSize)
        const observations = queue.splice(0, queuedObservationCount)
        const droppedCount =
          droppedToReport > 0 && observations.length < batchSize
            ? droppedToReport
            : 0
        if (droppedCount > 0)
          observations.push(droppedObservation(droppedToReport))
        pending = {
          queuedObservationCount,
          droppedCount,
          batch: {
            protocolVersion: 1,
            kind: 'observations.batch',
            requestId: idFactory(),
            observations,
          },
        }
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
            body: JSON.stringify(pending.batch),
          },
        )
        if (!response.ok)
          throw new Error(`Collector returned HTTP ${response.status}`)
        const acknowledgement = parseProtocolMessage(await response.json())
        assertCompleteAcknowledgement(pending.batch, acknowledgement)
        if (pending.droppedCount) reportedDropped += pending.droppedCount
        pending = undefined
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
    if (!activeFlush && hasWork()) activeFlush = drain()
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
    inspect: () => ({
      queued: queue.length + (pending?.queuedObservationCount ?? 0),
      dropped,
      closed,
    }),
  }
}

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value)) return fallback
  return Math.min(Math.max(1, value), maximum)
}

function assertCompleteAcknowledgement(
  batch: RuntimeObservationBatch,
  message: ReturnType<typeof parseProtocolMessage>,
): asserts message is RuntimeObservationAcknowledgement {
  if (message.kind !== 'observations.ack')
    throw new Error('Collector returned the wrong protocol message kind.')
  if (message.requestId !== batch.requestId)
    throw new Error('Collector acknowledgement request ID does not match.')
  if (message.accepted < 0 || message.duplicates < 0)
    throw new Error('Collector acknowledgement counts cannot be negative.')

  const observationIds = new Set(
    batch.observations.map((observation) => observation.observationId),
  )
  const rejectedIds = message.rejectedObservationIds ?? []
  const rejected = new Set(rejectedIds)
  if (
    rejected.size !== rejectedIds.length ||
    rejectedIds.some((observationId) => !observationIds.has(observationId))
  )
    throw new Error('Collector acknowledgement has invalid rejected IDs.')
  if (
    message.accepted + message.duplicates + rejected.size !==
    batch.observations.length
  )
    throw new Error('Collector acknowledgement does not account for the batch.')
}
