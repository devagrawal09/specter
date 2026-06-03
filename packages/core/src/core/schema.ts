import type { StandardSchemaV1 } from '@standard-schema/spec'

import type { MaybePromise } from './maybe-promise'
import { mapMaybePromise } from './maybe-promise'

export function decodeSchema<TSchema extends StandardSchemaV1>(
  schema: TSchema,
  input: unknown,
): MaybePromise<StandardSchemaV1.InferOutput<TSchema>> {
  const result = schema['~standard'].validate(input)

  return mapMaybePromise(result, (result) => {
    if (result.issues) throw result.issues

    return result.value as StandardSchemaV1.InferOutput<TSchema>
  })
}
