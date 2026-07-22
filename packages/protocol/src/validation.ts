import { protocolErrorCodes, SpecterProtocolError } from './errors'
import { digestSpecification, parseSpecification } from '@specter-ts/spec'
import {
  observationKinds,
  SPECTER_PROTOCOL_VERSION,
  type JsonValue,
  type ProtocolMessage,
  type RuntimeObservationBatch,
  type RuntimeObservation,
  type SpecificationPublication,
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
      optionalUniqueStrings(
        message.rejectedObservationIds,
        '$.rejectedObservationIds',
      )
      break
    case 'specifications.publish': {
      runtimeSource(message.source, '$.source')
      const specifications = array(message.specifications, '$.specifications')
      if (specifications.length > 100)
        fail('$.specifications must contain at most 100 items')
      specifications.forEach((value, index) => {
        const path = `$.specifications[${index}]`
        const published = record(value, path)
        const digest = specificationDigest(published.digest, `${path}.digest`)
        let canonicalDigest: string
        try {
          canonicalDigest = digestSpecification(
            parseSpecification(published.document),
          )
        } catch (cause) {
          throw new SpecterProtocolError({
            code: protocolErrorCodes.invalidMessage,
            message: `${path}.document is not a valid Slice specification.`,
            details: {
              path: `${path}.document`,
              reason: cause instanceof Error ? cause.message : String(cause),
            },
            cause,
          })
        }
        if (canonicalDigest !== digest)
          fail(
            `${path}.digest does not match the canonical specification document`,
          )
      })
      break
    }
    case 'specifications.ack':
      specificationDigests(message.acceptedDigests, '$.acceptedDigests')
      if (message.rejectedDigests !== undefined)
        specificationDigests(message.rejectedDigests, '$.rejectedDigests')
      break
    default:
      fail(`$.kind has unknown message kind ${kind}`)
  }
  return value as ProtocolMessage
}

export function parseProtocolJson(input: string): ProtocolMessage {
  let value: unknown
  try {
    value = JSON.parse(input)
  } catch (cause) {
    throw new SpecterProtocolError({
      code: protocolErrorCodes.invalidJson,
      message: 'Malformed JSON message.',
      cause,
    })
  }
  return parseProtocolMessage(value)
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

export function parseSpecificationPublication(
  value: unknown,
): SpecificationPublication {
  assertSpecificationPublication(value)
  return value
}

export function assertSpecificationPublication(
  value: unknown,
): asserts value is SpecificationPublication {
  const parsed = parseProtocolMessage(value)
  if (parsed.kind !== 'specifications.publish')
    fail('$.kind must be specifications.publish')
}

function runtimeObservation(value: unknown, path: string) {
  const input = record(value, path)
  causality(input, path)
  string(input.observationId, `${path}.observationId`)
  integer(input.sequence, `${path}.sequence`)
  timestamp(input.observedAt, `${path}.observedAt`)
  enumeration(input.kind, observationKinds, `${path}.kind`)
  runtimeSource(input.source, `${path}.source`)
  if (input.events !== undefined) events(input.events, `${path}.events`)
  if (input.error !== undefined) structuredError(input.error, `${path}.error`)
  optionalString(input.commandType, `${path}.commandType`)
  optionalString(input.queryType, `${path}.queryType`)
  optionalString(input.slice, `${path}.slice`)
  if (input.specificationDigest !== undefined)
    specificationDigest(
      input.specificationDigest,
      `${path}.specificationDigest`,
    )
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

function runtimeSource(value: unknown, path: string) {
  const source = record(value, path)
  for (const key of [
    'application',
    'environment',
    'runtimeLanguage',
    'runtimeVersion',
    'instanceId',
    'eventLogId',
  ]) {
    string(source[key], `${path}.${key}`)
  }
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
function optionalString(value: unknown, path: string) {
  if (value !== undefined) string(value, path)
}
function optionalUniqueStrings(value: unknown, path: string) {
  if (value === undefined) return
  const items = array(value, path)
  const unique = new Set<string>()
  items.forEach((item, index) => {
    const parsed = string(item, `${path}[${index}]`)
    if (unique.has(parsed)) fail(`${path} must contain unique strings`)
    unique.add(parsed)
  })
}
function specificationDigest(value: unknown, path: string): `sha256:${string}` {
  const digest = string(value, path)
  if (!/^sha256:[a-f0-9]{64}$/.test(digest))
    fail(`${path} must be a canonical sha256 digest`)
  return digest as `sha256:${string}`
}
function specificationDigests(value: unknown, path: string) {
  const digests = array(value, path)
  const unique = new Set<string>()
  digests.forEach((value, index) => {
    const digest = specificationDigest(value, `${path}[${index}]`)
    if (unique.has(digest)) fail(`${path} must contain unique digests`)
    unique.add(digest)
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
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(input)
  if (!match) fail(`${path} must be an RFC 3339 UTC timestamp`)
  const [
    ,
    yearInput,
    monthInput,
    dayInput,
    hourInput,
    minuteInput,
    secondInput,
  ] = match
  const year = Number(yearInput)
  const month = Number(monthInput)
  const day = Number(dayInput)
  const hour = Number(hourInput)
  const minute = Number(minuteInput)
  const second = Number(secondInput)
  const daysInMonth = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ]
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > (daysInMonth[month - 1] ?? 0) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
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
