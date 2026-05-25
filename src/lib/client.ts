import type { Effect } from 'effect'
import type * as Schema from 'effect/Schema'

import type { SpecterAppConfig } from './registry'
import type { CommandSlice, ProjectionSlice, SliceRegistration } from './slice'

type AnySchema = Schema.Schema.AnyNoContext
type SchemaType<TSchema extends AnySchema> = Schema.Schema.Type<TSchema>

type ConfigSlice<TConfig extends SpecterAppConfig> = TConfig['slices'][number]

type ClientMethod<TSlice extends SliceRegistration> =
  TSlice extends CommandSlice<string, infer TSchema>
    ? (input: SchemaType<TSchema>) => Effect.Effect<void, unknown>
    : TSlice extends ProjectionSlice<string, infer TSchema, infer TResult>
      ? (input: SchemaType<TSchema>) => Effect.Effect<TResult, unknown>
      : never

export type SpecterClient<TConfig extends SpecterAppConfig> = {
  [TSlice in ConfigSlice<TConfig> as TSlice['kind'] extends 'reaction'
    ? never
    : TSlice['name']]: ClientMethod<TSlice>
}

export function defineSpecterClient<const TConfig extends SpecterAppConfig>(
  config: TConfig,
  client: SpecterClient<TConfig>,
) {
  void config
  return client
}
