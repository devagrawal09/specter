import type { StandardSchemaV1 } from '@standard-schema/spec'

export async function decodeSchema<TSchema extends StandardSchemaV1>(
  schema: TSchema,
  input: unknown,
): Promise<StandardSchemaV1.InferOutput<TSchema>> {
  const result = await schema['~standard'].validate(input)

  if (result.issues) throw result.issues

  return result.value as StandardSchemaV1.InferOutput<TSchema>
}

export async function decodeOptionalSchema<TInput, TOutput>(
  schema: StandardSchemaV1<TInput, TOutput> | undefined,
  input: TInput,
): Promise<TOutput> {
  if (!schema) return input as unknown as TOutput

  return decodeSchema(schema, input)
}

export type SchemaValidation =
  | {
      readonly success: true
      readonly value: unknown
    }
  | {
      readonly success: false
      readonly issues: readonly StandardSchemaV1.Issue[]
    }

export async function validateSchema(
  schema: StandardSchemaV1,
  input: unknown,
): Promise<SchemaValidation> {
  try {
    const result = await schema['~standard'].validate(input)

    if (result.issues) {
      return { success: false, issues: result.issues }
    }

    return { success: true, value: result.value }
  } catch (cause) {
    return {
      success: false,
      issues: [
        {
          message:
            cause instanceof Error
              ? cause.message
              : `Schema validation threw: ${String(cause)}`,
        },
      ],
    }
  }
}

export function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true

  if (left instanceof Date && right instanceof Date) {
    return left.getTime() === right.getTime()
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => valuesEqual(value, right[index]))
    )
  }

  if (!isRecord(left) || !isRecord(right)) return false

  const leftKeys = Reflect.ownKeys(left)
  const rightKeys = Reflect.ownKeys(right)
  if (leftKeys.length !== rightKeys.length) return false

  return leftKeys.every(
    (key) => Object.hasOwn(right, key) && valuesEqual(left[key], right[key]),
  )
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return value !== null && typeof value === 'object'
}
