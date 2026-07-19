import { protocolErrorCodes, SpecterProtocolError } from './errors'
import {
  observationKinds,
  SPECTER_PROTOCOL_VERSION,
  type JsonValue,
  type ProtocolMessage,
  type RuntimeObservationBatch,
  type RuntimeObservation,
} from './types'

export function assertJsonValue(
  value: unknown,
  path = '$',
  seen = new Set<object>(),
): asserts value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return
  if (typeof value === 'number') {
    if (
      !Number.isFinite(value) ||
      (!Number.isSafeInteger(value) && Number.isInteger(value))
    ) {
      fail(`${path} must be a finite JSON-safe number`)
    }
    return
  }
  if (typeof value !== 'object') fail(`${path} is not JSON-compatible`)
  if (seen.has(value)) fail(`${path} contains a cycle`)
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        assertJsonValue(item, `${path}[${index}]`, seen)
      })
      return
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null)
      fail(`${path} must be a plain object`)
    for (const [key, item] of Object.entries(value))
      assertJsonValue(item, `${path}.${key}`, seen)
  } finally {
    seen.delete(value)
  }
}

export function parseProtocolMessage(value: unknown): ProtocolMessage {
  assertJsonValue(value)
  const message = record(value, '$')
  integer(message.protocolVersion, '$.protocolVersion')
  if (message.protocolVersion !== SPECTER_PROTOCOL_VERSION) {
    throw new SpecterProtocolError({
      code: protocolErrorCodes.versionMismatch,
      message: `Protocol major ${String(message.protocolVersion)} is unsupported; expected ${SPECTER_PROTOCOL_VERSION}.`,
      status: 426,
      details: {
        expected: SPECTER_PROTOCOL_VERSION,
        received: message.protocolVersion as number,
      },
    })
  }
  const kind = string(message.kind, '$.kind')
  string(message.requestId, '$.requestId')

  switch (kind) {
    case 'capabilities.request':
      optionalStrings(message.required, '$.required')
      optionalStrings(message.optional, '$.optional')
      break
    case 'capabilities.response': {
      const runtime = record(message.runtime, '$.runtime')
      string(runtime.language, '$.runtime.language')
      string(runtime.version, '$.runtime.version')
      strings(message.supported, '$.supported')
      strings(message.negotiated, '$.negotiated')
      break
    }
    case 'command.request':
      causality(message)
      namedPayload(message.command, '$.command')
      optionalString(message.idempotencyKey, '$.idempotencyKey')
      optionalInteger(message.expectedVersion, '$.expectedVersion')
      break
    case 'command.response':
      string(message.operationId, '$.operationId')
      enumeration(
        message.status,
        ['committed', 'duplicate', 'rejected'],
        '$.status',
      )
      integer(message.version, '$.version')
      events(message.events, '$.events')
      optionalString(message.reactionTicketId, '$.reactionTicketId')
      if (message.error !== undefined) structuredError(message.error, '$.error')
      if (message.status === 'rejected') {
        if (message.error === undefined)
          fail('$.error is required for a rejected command')
        if ((message.events as readonly unknown[]).length > 0)
          fail('$.events must be empty for a rejected command')
        if (message.reactionTicketId !== undefined)
          fail('$.reactionTicketId is not allowed for a rejected command')
      } else if (message.error !== undefined) {
        fail('$.error is only allowed for a rejected command')
      } else if (message.reactionTicketId === undefined) {
        fail('$.reactionTicketId is required for a committed command')
      }
      break
    case 'query.request':
    case 'subscription.request':
      causality(message)
      namedPayload(message.query, '$.query')
      if (kind === 'subscription.request')
        optionalInteger(message.afterSequence, '$.afterSequence')
      break
    case 'query.response':
      string(message.operationId, '$.operationId')
      if (message.result !== undefined)
        assertJsonValue(message.result, '$.result')
      if (message.error !== undefined) structuredError(message.error, '$.error')
      if (message.result === undefined && message.error === undefined)
        fail('$.result or $.error is required')
      if (message.result !== undefined && message.error !== undefined)
        fail('$.result and $.error are mutually exclusive')
      break
    case 'subscription.value':
      string(message.operationId, '$.operationId')
      integer(message.sequence, '$.sequence')
      assertJsonValue(message.result, '$.result')
      if (message.error !== undefined)
        fail('$.error is not allowed for a subscription value')
      break
    case 'subscription.error':
      string(message.operationId, '$.operationId')
      structuredError(message.error, '$.error')
      if (message.result !== undefined)
        fail('$.result is not allowed for a subscription error')
      if (message.sequence !== undefined)
        fail('$.sequence is not allowed for a subscription error')
      break
    case 'subscription.complete':
      string(message.operationId, '$.operationId')
      if (message.result !== undefined || message.error !== undefined)
        fail('$.result and $.error are not allowed for subscription completion')
      if (message.sequence !== undefined)
        fail('$.sequence is not allowed for subscription completion')
      break
    case 'reaction-ticket.request':
      string(message.reactionTicketId, '$.reactionTicketId')
      break
    case 'reaction-ticket.response':
      string(message.reactionTicketId, '$.reactionTicketId')
      enumeration(
        message.status,
        ['pending', 'completed', 'failed'],
        '$.status',
      )
      if (message.error !== undefined) structuredError(message.error, '$.error')
      if (message.status === 'failed' && message.error === undefined)
        fail('$.error is required for a failed reaction ticket')
      if (message.status !== 'failed' && message.error !== undefined)
        fail('$.error is only allowed for a failed reaction ticket')
      break
    case 'observations.batch': {
      const observations = array(message.observations, '$.observations')
      if (observations.length > 100)
        fail('$.observations must contain at most 100 items')
      observations.forEach((observation, index) => {
        runtimeObservation(observation, `$.observations[${index}]`)
      })
      break
    }
    case 'observations.ack':
      integer(message.accepted, '$.accepted')
      integer(message.duplicates, '$.duplicates')
      optionalStrings(
        message.rejectedObservationIds,
        '$.rejectedObservationIds',
      )
      break
    default:
      fail(`$.kind has unknown message kind ${kind}`)
  }
  return value as ProtocolMessage
}

export function parseRuntimeObservation(value: unknown): RuntimeObservation {
  assertJsonValue(value)
  runtimeObservation(value, '$')
  return value as RuntimeObservation
}

export function assertProtocolMessage(
  value: unknown,
): asserts value is ProtocolMessage {
  parseProtocolMessage(value)
}

export function parseRuntimeObservationBatch(
  value: unknown,
): RuntimeObservationBatch {
  assertRuntimeObservationBatch(value)
  return value
}

export function assertRuntimeObservationBatch(
  value: unknown,
): asserts value is RuntimeObservationBatch {
  const parsed = parseProtocolMessage(value)
  if (parsed.kind !== 'observations.batch') {
    fail('$.kind must be observations.batch')
  }
}

function runtimeObservation(value: unknown, path: string) {
  const input = record(value, path)
  causality(input, path)
  string(input.observationId, `${path}.observationId`)
  integer(input.sequence, `${path}.sequence`)
  timestamp(input.observedAt, `${path}.observedAt`)
  enumeration(input.kind, observationKinds, `${path}.kind`)
  const source = record(input.source, `${path}.source`)
  for (const key of [
    'application',
    'environment',
    'runtimeLanguage',
    'runtimeVersion',
    'instanceId',
    'eventLogId',
  ]) {
    string(source[key], `${path}.source.${key}`)
  }
  if (input.events !== undefined) events(input.events, `${path}.events`)
  if (input.error !== undefined) structuredError(input.error, `${path}.error`)
  optionalString(input.commandType, `${path}.commandType`)
  optionalString(input.queryType, `${path}.queryType`)
  optionalString(input.slice, `${path}.slice`)
  optionalString(input.reaction, `${path}.reaction`)
  if (input.outcome !== undefined)
    enumeration(
      input.outcome,
      ['succeeded', 'rejected', 'failed'],
      `${path}.outcome`,
    )
  if (input.attributes !== undefined)
    record(input.attributes, `${path}.attributes`)
  optionalInteger(input.cursor, `${path}.cursor`)
  optionalInteger(input.droppedCount, `${path}.droppedCount`)
}

function causality(input: Record<string, unknown>, path = '$') {
  string(input.operationId, `${path}.operationId`)
  optionalString(input.correlationId, `${path}.correlationId`)
  optionalUniqueStrings(input.parentOperationIds, `${path}.parentOperationIds`)
  optionalUniqueStrings(input.triggeringEventIds, `${path}.triggeringEventIds`)
  optionalString(input.reactionPassId, `${path}.reactionPassId`)
  optionalString(input.deliveryId, `${path}.deliveryId`)
  optionalString(input.attemptId, `${path}.attemptId`)
  if (input.triggeringEventOrder !== undefined) {
    const range = record(
      input.triggeringEventOrder,
      `${path}.triggeringEventOrder`,
    )
    integer(range.from, `${path}.triggeringEventOrder.from`)
    integer(range.to, `${path}.triggeringEventOrder.to`)
    if ((range.to as number) < (range.from as number))
      fail(`${path}.triggeringEventOrder.to must be >= from`)
  }
}

function events(value: unknown, path: string) {
  let previousOrder = -1
  array(value, path).forEach((item, index) => {
    const event = record(item, `${path}[${index}]`)
    string(event.eventId, `${path}[${index}].eventId`)
    string(event.type, `${path}[${index}].type`)
    integer(event.order, `${path}[${index}].order`)
    if ((event.order as number) <= previousOrder)
      fail(`${path} must be strictly ascending by Event order`)
    previousOrder = event.order as number
    integer(event.commitVersion, `${path}[${index}].commitVersion`)
    timestamp(event.recordedAt, `${path}[${index}].recordedAt`)
    if (event.attributes !== undefined)
      record(event.attributes, `${path}[${index}].attributes`)
  })
}

function namedPayload(value: unknown, path: string) {
  const input = record(value, path)
  string(input.type, `${path}.type`)
  assertJsonValue(input.payload, `${path}.payload`)
}

function structuredError(value: unknown, path: string) {
  const error = record(value, path)
  string(error.code, `${path}.code`)
  string(error.message, `${path}.message`)
  if (error.details !== undefined)
    assertJsonValue(error.details, `${path}.details`)
  if (error.retryable !== undefined && typeof error.retryable !== 'boolean')
    fail(`${path}.retryable must be a boolean`)
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    fail(`${path} must be an object`)
  return value as Record<string, unknown>
}
function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(`${path} must be an array`)
  return value
}
function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0)
    fail(`${path} must be a non-empty string`)
  return value
}
function strings(value: unknown, path: string) {
  array(value, path).forEach((item, index) => {
    string(item, `${path}[${index}]`)
  })
}
function optionalString(value: unknown, path: string) {
  if (value !== undefined) string(value, path)
}
function optionalStrings(value: unknown, path: string) {
  if (value !== undefined) strings(value, path)
}
function optionalUniqueStrings(value: unknown, path: string) {
  if (value === undefined) return
  const items = array(value, path)
  const unique = new Set<string>()
  items.forEach((item, index) => {
    const parsed = string(item, `${path}[${index}]`)
    if (unique.has(parsed)) fail(`${path} must contain unique IDs`)
    unique.add(parsed)
  })
}
function integer(value: unknown, path: string) {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    fail(`${path} must be a non-negative JSON-safe integer`)
}
function optionalInteger(value: unknown, path: string) {
  if (value !== undefined) integer(value, path)
}
function timestamp(value: unknown, path: string) {
  const input = string(value, path)
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(input) ||
    Number.isNaN(Date.parse(input))
  ) {
    fail(`${path} must be an RFC 3339 UTC timestamp`)
  }
}
function enumeration(value: unknown, allowed: readonly string[], path: string) {
  if (typeof value !== 'string' || !allowed.includes(value))
    fail(`${path} must be one of ${allowed.join(', ')}`)
}
function fail(message: string): never {
  throw new SpecterProtocolError({
    code: protocolErrorCodes.invalidMessage,
    message,
  })
}
