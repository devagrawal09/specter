import type { Effect } from 'effect'
import type * as Schema from 'effect/Schema'

import type { SpecterAppConfig } from './registry'
import type { CommandSlice, QuerySlice, SliceRegistration } from './slice'

type AnySchema = Schema.Schema.AnyNoContext
type SchemaType<TSchema extends AnySchema> = Schema.Schema.Type<TSchema>

type ConfigSlice<TConfig extends SpecterAppConfig> = TConfig['slices'][number]
const specterClientBrand: unique symbol = Symbol('SpecterClient')
const specterClientBrandValue: true = true

type ClientMethod<TSlice extends SliceRegistration> =
  TSlice extends CommandSlice<string, infer TSchema>
    ? (input: SchemaType<TSchema>) => Effect.Effect<void, unknown>
    : TSlice extends QuerySlice<string, infer TSchema, infer TResult>
      ? (input: SchemaType<TSchema>) => Effect.Effect<TResult, unknown>
      : never

type SpecterClientDefinition<TConfig extends SpecterAppConfig> = {
  [TSlice in ConfigSlice<TConfig> as TSlice['kind'] extends 'reaction'
    ? never
    : TSlice['name']]: ClientMethod<TSlice>
}

export type SpecterClient<TConfig extends SpecterAppConfig> =
  SpecterClientDefinition<TConfig> & {
    readonly [specterClientBrand]: true
  }

export type AnySpecterClient = SpecterClient<SpecterAppConfig>

export function defineSpecterClient<const TConfig extends SpecterAppConfig>(
  client: SpecterClientDefinition<TConfig>,
) {
  return Object.assign(client, {
    [specterClientBrand]: specterClientBrandValue,
  })
}
