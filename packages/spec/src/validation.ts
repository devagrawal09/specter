import {
  SPECTER_SPECIFICATION_FORMAT_VERSION,
  SPECTER_SPECIFICATION_SCHEMA,
  type JsonValue,
  type SliceSpecification,
} from './types.ts'

export class SpecterSpecificationError extends Error {
  readonly code = 'SPECTER_INVALID_SPECIFICATION' as const
}

export function assertPortableJson(
  value: unknown,
  path = '$',
  seen = new Set<object>(),
): asserts value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return
  if (typeof value === 'number') {
    if (
      !Number.isFinite(value) ||
      (Number.isInteger(value) && !Number.isSafeInteger(value))
    )
      fail(`${path} must be a finite JSON-safe number.`)
    return
  }
  if (typeof value !== 'object') fail(`${path} is not portable JSON.`)
  if (seen.has(value)) fail(`${path} contains a cycle.`)
  if (Object.getOwnPropertySymbols(value).length)
    fail(`${path} must not contain symbol-keyed properties.`)
  const prototype = Object.getPrototypeOf(value)
  if (
    !Array.isArray(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  )
    fail(`${path} must be a plain object.`)
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index))
          fail(`${path}[${index}] must not be a sparse array hole.`)
        assertPortableJson(value[index], `${path}[${index}]`, seen)
      }
    } else {
      for (const [key, item] of Object.entries(value))
        assertPortableJson(item, `${path}.${key}`, seen)
    }
  } finally {
    seen.delete(value)
  }
}

export function parseSpecification(input: unknown): SliceSpecification {
  assertPortableJson(input)
  const root = object(input, '$')
  exactKeys(
    root,
    ['$schema', 'formatVersion', 'kind', 'name', 'description', 'scenarios'],
    '$',
  )
  if (root.$schema !== SPECTER_SPECIFICATION_SCHEMA)
    fail(`$.$schema must be ${SPECTER_SPECIFICATION_SCHEMA}.`)
  if (root.formatVersion !== SPECTER_SPECIFICATION_FORMAT_VERSION)
    fail(`$.formatVersion must be ${SPECTER_SPECIFICATION_FORMAT_VERSION}.`)
  const kind = oneOf(
    root.kind,
    ['command', 'query', 'reaction'] as const,
    '$.kind',
  )
  nonEmptyString(root.name, '$.name')
  if (!/^[a-z][A-Za-z0-9]*$/.test(root.name as string))
    fail('$.name must use lower camel case.')
  nonEmptyString(root.description, '$.description')
  const scenarios = array(root.scenarios, '$.scenarios')
  if (!scenarios.length) fail('$.scenarios must contain at least one scenario.')
  const descriptions = new Set<string>()
  scenarios.forEach((value, index) => {
    const path = `$.scenarios[${index}]`
    const scenario = object(value, path)
    const allowed =
      kind === 'reaction'
        ? ['description', 'given', 'expect']
        : kind === 'query'
          ? ['description', 'given', 'when', 'expect']
          : ['description', 'given', 'when', 'expect', 'reject']
    exactKeys(scenario, allowed, path)
    const description = nonEmptyString(
      scenario.description,
      `${path}.description`,
    )
    if (descriptions.has(description))
      fail(`${path}.description must be unique within the Slice.`)
    descriptions.add(description)
    array(scenario.given, `${path}.given`).forEach((event, eventIndex) => {
      scenarioEvent(event, `${path}.given[${eventIndex}]`)
    })
    if (kind !== 'reaction' && !Object.hasOwn(scenario, 'when'))
      fail(`${path}.when is required.`)
    if (!Object.hasOwn(scenario, 'expect')) fail(`${path}.expect is required.`)
    if (kind === 'command') {
      const expected = array(scenario.expect, `${path}.expect`)
      expected.forEach((event, eventIndex) => {
        scenarioEvent(event, `${path}.expect[${eventIndex}]`)
      })
      if (scenario.reject !== undefined) {
        if (expected.length)
          fail(`${path}.reject is only valid when expect is empty.`)
        const reject = object(scenario.reject, `${path}.reject`)
        exactKeys(reject, ['reason'], `${path}.reject`)
        nonEmptyString(reject.reason, `${path}.reject.reason`)
      } else if (!expected.length) {
        fail(`${path} must expect Events or define an exact rejection reason.`)
      }
    } else if (kind === 'reaction') {
      array(scenario.expect, `${path}.expect`)
    }
  })
  return structuredClone(input) as SliceSpecification
}

export function parseSpecificationJson(input: string): SliceSpecification {
  let value: unknown
  try {
    value = JSON.parse(input)
  } catch (cause) {
    throw new SpecterSpecificationError(
      `Specification JSON is malformed: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  return parseSpecification(value)
}

function scenarioEvent(value: unknown, path: string) {
  const event = object(value, path)
  exactKeys(event, ['kind', 'eventType', 'examplePayload'], path)
  if (event.kind !== 'scenario-event')
    fail(`${path}.kind must be scenario-event.`)
  nonEmptyString(event.eventType, `${path}.eventType`)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(event.eventType as string))
    fail(`${path}.eventType must use kebab-case.`)
  if (!Object.hasOwn(event, 'examplePayload'))
    fail(`${path}.examplePayload is required.`)
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
) {
  const allowedSet = new Set(allowed)
  const unknown = Object.keys(value).find((key) => !allowedSet.has(key))
  if (unknown) fail(`${path}.${unknown} is not allowed.`)
  const missing = allowed.find(
    (key) => !Object.hasOwn(value, key) && !['reject'].includes(key),
  )
  if (missing) fail(`${path}.${missing} is required.`)
}
function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    fail(`${path} must be an object.`)
  return value as Record<string, unknown>
}
function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(`${path} must be an array.`)
  return value
}
function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim())
    fail(`${path} must be a non-empty string.`)
  return value
}
function oneOf<const T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T))
    fail(`${path} must be one of ${allowed.join(', ')}.`)
  return value as T
}
function fail(message: string): never {
  throw new SpecterSpecificationError(message)
}
