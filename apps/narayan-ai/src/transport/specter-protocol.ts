export type JsonPrimitive = string | number | boolean | null

export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

export type SpecterWireError = {
  readonly error: {
    readonly code: string
    readonly message: string
    readonly details?: JsonValue
  }
}

export type SpecterWireCommandExecution = {
  readonly events: readonly JsonValue[]
  readonly version: number
  readonly duplicate: boolean
  readonly reactionId: string
}

export function assertJsonCompatible(
  value: unknown,
  path = '$',
  seen = new Set<object>(),
): asserts value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} must be a finite JSON number`)
    }
    return
  }

  if (typeof value !== 'object') {
    throw new TypeError(`${path} is not JSON-compatible`)
  }

  if (seen.has(value)) {
    throw new TypeError(`${path} contains a cyclic reference`)
  }
  seen.add(value)

  try {
    if (Array.isArray(value)) {
      for (const [index, item] of value.entries()) {
        assertJsonCompatible(item, `${path}[${index}]`, seen)
      }
      return
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} must be a plain JSON object`)
    }

    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError(`${path} must not contain symbol keys`)
    }

    for (const [key, item] of Object.entries(value)) {
      assertJsonCompatible(item, `${path}.${key}`, seen)
    }
  } finally {
    seen.delete(value)
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isWireError(value: unknown): value is SpecterWireError {
  return (
    isRecord(value) &&
    isRecord(value.error) &&
    typeof value.error.code === 'string' &&
    typeof value.error.message === 'string'
  )
}
