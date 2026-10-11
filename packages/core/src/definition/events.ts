import type { StandardSchemaV1 } from '@standard-schema/spec'

import { decodeSchema } from './schemas'

export type EventDraft<TType extends string = string, TPayload = unknown> = {
  readonly type: TType
  readonly payload: TPayload
}

export type Event<
  TType extends string = string,
  TPayload = unknown,
> = EventDraft<TType, TPayload> & {
  readonly id: string
  readonly recordedAt: string
}

export type PersistedEvent<
  TType extends string = string,
  TPayload = unknown,
> = Event<TType, TPayload> & {
  readonly order: number
}

export type EventDefinition<
  TType extends string = string,
  TPayload = unknown,
> = {
  readonly type: TType
  readonly schema: StandardSchemaV1
  readonly create: (payload: TPayload) => EventDraft<TType, TPayload>
  readonly decode: (payload: unknown) => Promise<TPayload>
  /**
   * The keys an Event of this type carries: the identities of what it is
   * about, such as its aggregate's ID. Absent for an unkeyed Event type.
   */
  readonly keys?: (payload: TPayload) => readonly string[]
}

export type EventDefinitionOptions<TPayload> = {
  /**
   * Derives an Event's keys from its payload. A Command that declares
   * consistency keys conflicts only with new Events carrying one of them (or
   * none), and a keyed Reaction handles each key a commit's Events carry.
   */
  readonly keys?: (payload: TPayload) => readonly string[]
}

export function createEventDefinition<
  const TType extends string,
  TSchema extends StandardSchemaV1,
>(
  type: TType,
  schema: TSchema,
  options: EventDefinitionOptions<StandardSchemaV1.InferOutput<TSchema>> = {},
): EventDefinition<TType, StandardSchemaV1.InferOutput<TSchema>> {
  const decode = (payload: unknown) => decodeSchema(schema, payload)

  return {
    type,
    schema,
    create: (payload) => ({
      type,
      payload,
    }),
    decode,
    ...(options.keys ? { keys: options.keys } : {}),
  }
}

/**
 * The keys one Event carries, or undefined when it carries none: its type
 * declares no keys, or they are empty for this payload. Throws when a key
 * function returns anything but an array of strings.
 */
export function eventKeys(
  definition:
    | {
        readonly type: string
        readonly keys?: (payload: never) => readonly string[]
      }
    | undefined,
  payload: unknown,
): readonly string[] | undefined {
  if (!definition?.keys) return undefined
  const keys: unknown = (definition.keys as (payload: unknown) => unknown)(
    payload,
  )
  if (!Array.isArray(keys) || keys.some((key) => typeof key !== 'string')) {
    throw new TypeError(
      `Event "${definition.type}" keys must be an array of strings.`,
    )
  }
  return keys.length > 0 ? (keys as readonly string[]) : undefined
}
