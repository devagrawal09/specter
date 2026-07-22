import type {
  RuntimeObservation,
  RuntimeObservationAcknowledgement,
  RuntimeObservationBatch,
  RuntimeSource,
  SpecificationAcknowledgement,
  SpecificationPublication,
} from '@specter-ts/protocol'
import { parseProtocolMessage } from '@specter-ts/protocol'
import {
  digestSpecification,
  parseSpecification,
  type SliceSpecification,
} from '@specter-ts/spec'

import { DEFAULT_OBSERVATION_RETRY_WINDOW_MS } from './retry-window'

export type RuntimeObservationProducerOptions = {
  readonly collectorUrl: string
  readonly source: RuntimeSource
  readonly fetch?: typeof globalThis.fetch
  readonly idFactory?: () => string
  readonly now?: () => Date
  readonly maxQueuedObservations?: number
  readonly maxBatchSize?: number
  readonly retryDelayMs?: number
  readonly maxRetryDelayMs?: number
  readonly retryWindowMs?: number
  readonly closeTimeoutMs?: number
  /** Explicit opt-in: publishes full synthetic specification examples. */
  readonly specifications?: readonly SliceSpecification[]
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
  const retryWindow = boundedPositiveInteger(
    options.retryWindowMs,
    DEFAULT_OBSERVATION_RETRY_WINDOW_MS,
  )
  const closeTimeout = Math.max(0, options.closeTimeoutMs ?? 5_000)
  const queue: RuntimeObservation[] = []
  let dropped = 0
  let reportedDropped = 0
  let activeFlush: Promise<void> | undefined
  let retryDelay = initialRetryDelay
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let requestAbort: AbortController | undefined
  let closed = false
  let closePromise: Promise<void> | undefined
  let telemetrySequence = 0
  let pending:
    | {
        readonly batch: RuntimeObservationBatch
        readonly queuedObservationCount: number
        readonly droppedCount: number
        readonly createdAt: number
      }
    | undefined
  let specificationTimer: ReturnType<typeof setTimeout> | undefined
  let specificationAbort: AbortController | undefined

  if (options.specifications?.length)
    queueMicrotask(() => void publishSpecifications())

  async function publishSpecifications() {
    const startedAt = now().getTime()
    let delay = initialRetryDelay
    let remaining =
      options.specifications?.map((document) => {
        const parsed = parseSpecification(document)
        return { digest: digestSpecification(parsed), document: parsed }
      }) ?? []
    while (
      !closed &&
      remaining.length &&
      now().getTime() - startedAt < retryWindow
    ) {
      try {
        const candidates = remaining.slice(0, 100)
        const batch: SpecificationPublication = {
          protocolVersion: 1,
          kind: 'specifications.publish',
          requestId: idFactory(),
          source: options.source,
          specifications: candidates,
        }
        specificationAbort = new AbortController()
        const response = await fetchImplementation(
          `${options.collectorUrl.replace(/\/$/, '')}/specter/v1/specifications`,
          {
            method: 'POST',
            headers: {
              accept: 'application/json',
              'content-type': 'application/json',
            },
            body: JSON.stringify(batch),
            signal: specificationAbort.signal,
          },
        )
        if (!response.ok)
          throw new Error(`Collector returned HTTP ${response.status}`)
        const acknowledgement = parseProtocolMessage(await response.json())
        assertSpecificationAcknowledgement(batch, acknowledgement)
        const accepted = new Set(acknowledgement.acceptedDigests)
        const rejected = new Set(acknowledgement.rejectedDigests ?? [])
        remaining = remaining.filter(
          (item) => !accepted.has(item.digest) && !rejected.has(item.digest),
        )
        if (accepted.size > 0) delay = initialRetryDelay
        else {
          await waitForSpecificationRetry(delay)
          delay = Math.min(maxRetryDelay, delay * 2)
        }
      } catch {
        await waitForSpecificationRetry(delay)
        delay = Math.min(maxRetryDelay, delay * 2)
      } finally {
        specificationAbort = undefined
      }
    }
  }

  async function waitForSpecificationRetry(delay: number) {
    await new Promise<void>((resolve) => {
      specificationTimer = setTimeout(resolve, delay)
      unrefTimer(specificationTimer)
    })
    specificationTimer = undefined
  }

  function record(observation: RuntimeObservation) {
    if (closed) return
    telemetrySequence = Math.max(telemetrySequence, observation.sequence)
    const immutablePendingCount = pending?.batch.observations.length ?? 0
    const mutableCapacity = Math.max(0, capacity - immutablePendingCount)
    while (queue.length >= mutableCapacity && queue.length > 0) {
      queue.shift()
      dropped += 1
    }
    if (mutableCapacity === 0) {
      // The in-flight batch must remain byte-for-byte stable for safe retry.
      // When it occupies the entire bound, the incoming observation is the
      // only entry that can be dropped without violating that guarantee.
      dropped += 1
      scheduleFlush()
      return
    }
    queue.push(structuredClone(observation))
    scheduleFlush()
  }

  function scheduleFlush() {
    if (closed || activeFlush || retryTimer || !hasWork()) return
    queueMicrotask(() => {
      if (!closed && !activeFlush && !retryTimer && hasWork()) {
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
          droppedToReport > 0 &&
          observations.length < batchSize &&
          observations.length < capacity
            ? droppedToReport
            : 0
        if (droppedCount > 0)
          observations.push(droppedObservation(droppedToReport))
        pending = {
          queuedObservationCount,
          droppedCount,
          createdAt: now().getTime(),
          batch: {
            protocolVersion: 1,
            kind: 'observations.batch',
            requestId: idFactory(),
            observations,
          },
        }
      }

      if (now().getTime() - pending.createdAt >= retryWindow) {
        dropped += pending.queuedObservationCount
        pending = undefined
        retryDelay = initialRetryDelay
        continue
      }

      try {
        const abort = new AbortController()
        requestAbort = abort
        const response = await fetchImplementation(
          `${options.collectorUrl.replace(/\/$/, '')}/specter/v1/observations`,
          {
            method: 'POST',
            headers: {
              accept: 'application/json',
              'content-type': 'application/json',
            },
            body: JSON.stringify(pending.batch),
            signal: abort.signal,
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
        if (closed) return
        retryTimer = setTimeout(() => {
          retryTimer = undefined
          scheduleFlush()
        }, retryDelay)
        unrefTimer(retryTimer)
        retryDelay = Math.min(maxRetryDelay, retryDelay * 2)
        return
      } finally {
        requestAbort = undefined
      }
    }
  }

  async function flush() {
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = undefined
    }
    if (specificationTimer) clearTimeout(specificationTimer)
    specificationAbort?.abort()
    if (!activeFlush && hasWork()) activeFlush = drain()
    const currentFlush = activeFlush
    await currentFlush
    if (activeFlush === currentFlush) activeFlush = undefined
  }

  function close() {
    closePromise ??= closeProducer()
    return closePromise
  }

  async function closeProducer() {
    closed = true
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = undefined
    }
    const finalAttempt = flush()
    let timeout: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      finalAttempt,
      new Promise<void>((resolve) => {
        timeout = setTimeout(() => {
          requestAbort?.abort()
          resolve()
        }, closeTimeout)
        unrefTimer(timeout)
      }),
    ])
    if (timeout) clearTimeout(timeout)
  }

  return {
    record,
    flush,
    close,
    inspect: () => ({
      queued: queue.length + (pending?.batch.observations.length ?? 0),
      dropped,
      closed,
    }),
  }
}

function assertSpecificationAcknowledgement(
  publication: SpecificationPublication,
  message: ReturnType<typeof parseProtocolMessage>,
): asserts message is SpecificationAcknowledgement {
  if (
    message.kind !== 'specifications.ack' ||
    message.requestId !== publication.requestId
  )
    throw new Error(
      'Collector returned an invalid specification acknowledgement.',
    )
  const published = new Set(
    publication.specifications.map((item) => item.digest),
  )
  const acknowledged = [
    ...message.acceptedDigests,
    ...(message.rejectedDigests ?? []),
  ]
  if (acknowledged.some((digest) => !published.has(digest)))
    throw new Error('Collector acknowledged an unknown specification digest.')
  if (new Set(acknowledged).size !== acknowledged.length)
    throw new Error(
      'Collector acknowledged a specification digest more than once.',
    )
}

function unrefTimer(timer: ReturnType<typeof setTimeout>) {
  const timerWithUnref = timer as unknown as { unref?: () => void }
  timerWithUnref.unref?.()
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
