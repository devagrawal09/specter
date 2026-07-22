#!/usr/bin/env node
import { createClient } from '@libsql/client/sqlite3'
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { mkdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  createSpecterSqlitePersistence,
  prepareSpecterSqlite,
} from '@specter-ts/sqlite'
import {
  assertRuntimeObservationBatch,
  structuredProtocolError,
} from '@specter-ts/protocol'
import type {
  RuntimeObservationAcknowledgement,
  RuntimeObservationBatch,
} from '@specter-ts/protocol'

import { publicCliErrorMessage, UsageError } from './cli-errors'
import { createCollectorState } from './collector-model'
import {
  acceptObservationReservation,
  type ObservationReservation,
  prepareObservationDeduplication,
  reconcileObservationReservations,
  releaseObservationReservation,
  reserveObservations,
} from './collector-deduplication'
import {
  createSpecterObservabilityCollector,
  type SpecterObservabilityCollector,
} from './collector'
import { createSpecterObservabilityHttpHandler } from './http-handler'
import { SegmentCoordinator } from './segment-coordinator'
import { existingSegmentPaths, sqliteDatabaseSize } from './segment-storage'
import { DEFAULT_OBSERVATION_RETRY_WINDOW_MS } from './retry-window'

type ActiveSegment = {
  readonly collector: SpecterObservabilityCollector
  readonly handler: (request: Request) => Promise<Response>
  readonly client: ReturnType<typeof createClient>
  readonly path: string
  readonly openedAt: number
  readonly abort: AbortController
}

const args = process.argv.slice(2)
const command = args[0] ?? 'snapshot'

try {
  if (command === 'serve') await serve(args.slice(1))
  else if (command === 'snapshot') await snapshot(args.slice(1))
  else if (command === 'watch') await watch(args.slice(1))
  else if (command === 'trace') await trace(args.slice(1))
  else if (command === 'help' || command === '--help' || command === '-h')
    help()
  else throw new UsageError(`Unknown command: ${command}`)
} catch (cause) {
  console.error(publicCliErrorMessage(cause))
  process.exitCode = 1
}

async function serve(commandArgs: readonly string[]) {
  const port = integerOption(commandArgs, '--port', 41736)
  const host = stringOption(commandArgs, '--host', '127.0.0.1')
  const databaseBase = resolve(
    stringOption(commandArgs, '--database', './data/specter-observability'),
  )
  const maxAgeMs = integerOption(
    commandArgs,
    '--max-age-ms',
    24 * 60 * 60 * 1_000,
  )
  const maxBytes = integerOption(commandArgs, '--max-bytes', 64 * 1024 * 1024)
  const retryWindowMs = integerOption(
    commandArgs,
    '--retry-window-ms',
    DEFAULT_OBSERVATION_RETRY_WINDOW_MS,
  )
  mkdirSync(dirname(databaseBase), { recursive: true })

  const controlClient = createClient({ url: `file:${databaseBase}-control.db` })
  const existingSegments = existingSegmentPaths(databaseBase)
  await prepareObservationDeduplication(
    controlClient,
    new Date(),
    existingSegments,
    retryWindowMs,
  )

  const initial = await openSegment(databaseBase, existingSegments.at(-1))
  const segments = new SegmentCoordinator({
    initial,
    shouldRotate(segment: ActiveSegment) {
      const age = Date.now() - segment.openedAt
      return age >= maxAgeMs || sqliteDatabaseSize(segment.path) >= maxBytes
    },
    open: () => openSegment(databaseBase),
    retire(segment: ActiveSegment) {
      segment.abort.abort(new Error('Observability segment rotated'))
    },
    close(segment: ActiveSegment) {
      segment.client.close()
    },
  })
  const liveReservationIds = new Set<string>()

  const server = createServer(async (request, response) => {
    const isObservationProtocolRequest =
      request.method === 'POST' &&
      new URL(request.url ?? '/', `http://${host}:${port}`).pathname ===
        '/specter/v1/observations'
    let releaseSegment: (() => void) | undefined
    let reservation: ObservationReservation | undefined
    let reservationCompleted = false
    let segmentCommitCompleted = false
    try {
      const lease = await segments.acquire()
      releaseSegment = lease.release
      const active = lease.segment
      const webRequest = await toWebRequest(request, `http://${host}:${port}`)
      const observationInput =
        webRequest.method === 'POST' &&
        new URL(webRequest.url).pathname === '/specter/v1/observations'
          ? await readDedupeCandidate(webRequest)
          : undefined
      const observationBatch = isDedupeCandidate(observationInput)
        ? observationInput
        : undefined
      let reservationResult = observationBatch
        ? await reserveObservations(
            observationBatch,
            controlClient,
            crypto.randomUUID(),
            new Date(),
            retryWindowMs,
          )
        : undefined
      if (
        observationBatch &&
        reservationResult?.status === 'busy' &&
        reservationResult.reservationIds.every(
          (reservationId) => !liveReservationIds.has(reservationId),
        )
      ) {
        await reconcileObservationReservations(
          controlClient,
          existingSegmentPaths(databaseBase),
          new Date(),
          reservationResult.reservationIds,
        )
        reservationResult = await reserveObservations(
          observationBatch,
          controlClient,
          crypto.randomUUID(),
          new Date(),
          retryWindowMs,
        )
      }
      if (reservationResult?.status === 'busy') {
        await sendWebResponse(response, observationReservationBusy())
        return
      }
      reservation = reservationResult?.reservation
      if (reservation && reservation.batch.observations.length === 0) {
        reservationCompleted = true
        await sendWebResponse(
          response,
          observationAcknowledgement(
            observationBatch as RuntimeObservationBatch,
            0,
            reservation.duplicates,
          ),
        )
        return
      }
      if (reservation) liveReservationIds.add(reservation.reservationId)
      const handlerRequest = reservation
        ? requestWithBatch(webRequest, reservation.batch)
        : webRequest
      let webResponse = await active.handler(handlerRequest)
      if (observationBatch && reservation && webResponse.ok) {
        segmentCommitCompleted = true
        const acknowledgement = (await webResponse
          .clone()
          .json()) as RuntimeObservationAcknowledgement
        const rejected = new Set(acknowledgement.rejectedObservationIds ?? [])
        await acceptObservationReservation(
          reservation,
          reservation.batch.observations.filter(
            (observation) => !rejected.has(observation.observationId),
          ),
          controlClient,
        )
        await releaseObservationReservation(reservation, controlClient)
        reservationCompleted = true
        webResponse = Response.json(
          {
            ...acknowledgement,
            duplicates: acknowledgement.duplicates + reservation.duplicates,
          },
          { status: webResponse.status, headers: webResponse.headers },
        )
      }
      await sendWebResponse(response, webResponse)
    } catch (cause) {
      const error = structuredProtocolError(cause)
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      }
      if (isObservationProtocolRequest)
        headers['Specter-Protocol-Version'] = '1'
      response.writeHead(500, headers)
      response.end(
        JSON.stringify({
          error: {
            code: 'SPECTER_OBSERVABILITY_SERVER_FAILURE',
            message: error.message,
          },
        }),
      )
    } finally {
      if (reservation) liveReservationIds.delete(reservation.reservationId)
      if (reservation && !reservationCompleted && !segmentCommitCompleted) {
        await releaseObservationReservation(reservation, controlClient).catch(
          () => {},
        )
      }
      releaseSegment?.()
    }
  })

  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => resolvePromise())
  })
  console.log(
    `Specter observability collector listening on http://${host}:${port}`,
  )
  console.log(`Active segment: ${initial.path}`)

  const shutdown = async () => {
    const segmentShutdown = segments.shutdown()
    await new Promise<void>((resolvePromise) =>
      server.close(() => resolvePromise()),
    )
    await segmentShutdown
    controlClient.close()
  }
  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())
}

async function openSegment(
  databaseBase: string,
  existingPath?: string,
): Promise<ActiveSegment> {
  const timestamp = new Date().toISOString().replaceAll(/[^0-9]/g, '')
  const path = existingPath ?? `${databaseBase}-${timestamp}.db`
  const openedAt = existingPath
    ? statSync(existingPath).birthtimeMs
    : Date.now()
  const client = createClient({ url: `file:${path}` })
  await prepareSpecterSqlite(client)
  const persistence = createSpecterSqlitePersistence(client)
  const collector = await createSpecterObservabilityCollector({
    eventLog: persistence.eventLog,
    store: persistence.createSliceStore(createCollectorState),
  })
  const abort = new AbortController()
  return {
    collector,
    client,
    path,
    openedAt,
    abort,
    handler: createSpecterObservabilityHttpHandler({
      collector,
      signal: abort.signal,
    }),
  }
}

function requestWithBatch(request: Request, batch: RuntimeObservationBatch) {
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify(batch),
  })
}

function observationReservationBusy() {
  return Response.json(
    {
      error: {
        code: 'SPECTER_OBSERVATION_IN_FLIGHT',
        message: 'An observation in this batch is still being ingested.',
      },
    },
    {
      status: 503,
      headers: {
        'retry-after': '1',
        'Specter-Protocol-Version': '1',
      },
    },
  )
}

async function readDedupeCandidate(request: Request): Promise<unknown> {
  try {
    return await request.clone().json()
  } catch {
    return undefined
  }
}

function observationAcknowledgement(
  batch: RuntimeObservationBatch,
  accepted: number,
  duplicates: number,
) {
  return Response.json(
    {
      protocolVersion: 1,
      kind: 'observations.ack',
      requestId: batch.requestId,
      accepted,
      duplicates,
    } satisfies RuntimeObservationAcknowledgement,
    { headers: { 'Specter-Protocol-Version': '1' } },
  )
}

function isDedupeCandidate(value: unknown): value is RuntimeObservationBatch {
  try {
    assertRuntimeObservationBatch(value)
    return true
  } catch {
    return false
  }
}

async function snapshot(commandArgs: readonly string[]) {
  const url = endpoint(commandArgs)
  const value = await fetchJson(`${url}/v1/overview`)
  if (stringOption(commandArgs, '--format', 'json') === 'text') {
    const overview = value as {
      observationCount: number
      failureCount: number
      droppedObservationCount: number
      sources: readonly unknown[]
    }
    console.log(`Observations: ${overview.observationCount}`)
    console.log(`Failures: ${overview.failureCount}`)
    console.log(`Dropped: ${overview.droppedObservationCount}`)
    console.log(`Sources: ${overview.sources.length}`)
    return
  }
  console.log(JSON.stringify(value, null, 2))
}

async function trace(commandArgs: readonly string[]) {
  const operationId = positional(commandArgs, 0)
  if (!operationId) throw new UsageError('trace requires an operation ID')
  const filters = filterOptions(commandArgs)
  const query = new URLSearchParams(
    Object.entries({
      application: filters.application,
      environment: filters.environment,
      instanceId: filters.instanceId,
      eventLogId: filters.eventLogId,
    }).filter((entry): entry is [string, string] => Boolean(entry[1])),
  )
  const queryString = query.size ? `?${query}` : ''
  const value = await fetchJson(
    `${endpoint(commandArgs)}/v1/traces/${encodeURIComponent(operationId)}${queryString}`,
  )
  if (stringOption(commandArgs, '--format', 'json') === 'text') {
    const traceValue = value as {
      observations: readonly { kind: string; operationId: string }[]
      edges: readonly { from: string; to: string; relation: string }[]
    }
    for (const item of traceValue.observations) {
      console.log(`${item.operationId} ${item.kind}`)
    }
    for (const edge of traceValue.edges) {
      console.log(`  ${edge.from} -> ${edge.to} (${edge.relation})`)
    }
    return
  }
  console.log(JSON.stringify(value, null, 2))
}

async function watch(commandArgs: readonly string[]) {
  const filter = filterOptions(commandArgs)
  const query = new URLSearchParams(
    Object.entries(filter).filter((entry): entry is [string, string] =>
      Boolean(entry[1]),
    ),
  )
  for (;;) {
    const response = await fetch(`${endpoint(commandArgs)}/v1/stream?${query}`)
    if (!response.ok || !response.body) {
      throw new Error(`Collector stream returned HTTP ${response.status}`)
    }
    for await (const data of decodeSse(response.body)) console.log(data)
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
  }
}

function filterOptions(commandArgs: readonly string[]): Record<string, string> {
  return {
    application: stringOption(commandArgs, '--application', ''),
    environment: stringOption(commandArgs, '--environment', ''),
    instanceId: stringOption(commandArgs, '--instance', ''),
    eventLogId: stringOption(commandArgs, '--event-log', ''),
    kind: stringOption(commandArgs, '--kind', ''),
    operationId: stringOption(commandArgs, '--operation', ''),
    correlationId: stringOption(commandArgs, '--correlation', ''),
    slice: stringOption(commandArgs, '--slice', ''),
    reaction: stringOption(commandArgs, '--reaction', ''),
    afterSequence: stringOption(commandArgs, '--sequence', ''),
  }
}

async function* decodeSse(body: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true })
    for (;;) {
      const boundary = buffer.indexOf('\n\n')
      if (boundary < 0) break
      const event = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const data = event
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      if (data) yield data
    }
  }
}

async function fetchJson(url: string) {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok)
    throw new Error(`Collector returned HTTP ${response.status}`)
  return response.json() as Promise<unknown>
}

function endpoint(commandArgs: readonly string[]) {
  return stringOption(commandArgs, '--url', 'http://127.0.0.1:41736').replace(
    /\/$/,
    '',
  )
}

function positional(commandArgs: readonly string[], index: number) {
  return commandArgs.filter((value, itemIndex) => {
    if (value.startsWith('--')) return false
    return itemIndex === 0 || !commandArgs[itemIndex - 1]?.startsWith('--')
  })[index]
}

function stringOption(
  commandArgs: readonly string[],
  name: string,
  fallback: string,
) {
  const index = commandArgs.indexOf(name)
  return index < 0 ? fallback : (commandArgs[index + 1] ?? fallback)
}

function integerOption(
  commandArgs: readonly string[],
  name: string,
  fallback: number,
) {
  const value = Number(stringOption(commandArgs, name, String(fallback)))
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new UsageError(`${name} must be a positive integer`)
  }
  return value
}

async function toWebRequest(request: IncomingMessage, origin: string) {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const body = chunks.length ? Buffer.concat(chunks) : undefined
  return new Request(new URL(request.url ?? '/', origin), {
    method: request.method,
    headers: request.headers as HeadersInit,
    body:
      request.method === 'GET' || request.method === 'HEAD' ? undefined : body,
  })
}

async function sendWebResponse(
  response: ServerResponse,
  webResponse: Response,
) {
  response.writeHead(
    webResponse.status,
    Object.fromEntries(webResponse.headers),
  )
  if (!webResponse.body) {
    response.end()
    return
  }
  for await (const chunk of webResponse.body) response.write(Buffer.from(chunk))
  response.end()
}

function help() {
  console.log(`specter-observe <command>

Commands:
  serve     Run the collector on strict port 41736
  snapshot  Print the current collector overview
  watch     Stream activity as NDJSON
  trace ID  Print a causal operation trace

Common options:
  --url URL             Collector URL (default http://127.0.0.1:41736)
  --format json|text    Output format
  --application NAME    Filter by application
  --environment NAME    Filter by environment
  --instance ID         Filter by process instance
  --event-log ID        Filter by Event Log
  --kind KIND           Filter by observation kind
  --operation ID        Filter by operation
  --correlation ID      Filter by correlation ID
  --slice NAME          Filter by Slice
  --reaction NAME       Filter by Reaction
  --sequence NUMBER     Filter after source-local sequence

Serve options:
  --retry-window-ms N   Bound producer retry deduplication (default 48 hours)`)
}
