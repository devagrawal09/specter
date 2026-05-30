import type { StandardSchemaV1 } from '@standard-schema/spec'

export async function decodeSchema<TSchema extends StandardSchemaV1>(
  schema: TSchema,
  input: unknown,
): Promise<StandardSchemaV1.InferOutput<TSchema>> {
  const result = await schema['~standard'].validate(input)
  if (result.issues) throw result.issues
  return result.value as StandardSchemaV1.InferOutput<TSchema>
}
