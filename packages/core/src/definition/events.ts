import type { StandardSchemaV1 } from '@standard-schema/spec'

import { decodeSchema } from './schemas'

export type EventDraft<TType extends string = string, TPayload = unknown> = {
  readonly type: TType
  readonly payload: TPayload
}

/**
 * An Event as the Event Log recorded it: its draft, the ID and time it was
 * recorded under, its position in the log, and the keys stored with it. Apply
 * handlers receive it, so a fold can read when and in what order its facts
 * were recorded.
 */
export type PersistedEvent<
  TType extends string = string,
  TPayload = unknown,
> = EventDraft<TType, TPayload> & {
  /** Unique in the log: the host's when it supplied one, else the Event Log's. */
  readonly id: string
  /** ISO-8601: when the host recorded it when it supplied a time, else when the Event Log appended it. */
  readonly recordedAt: string
  /** Its unique global position, strictly ascending in the log. */
  readonly order: number
  /**
   * The named keys stored with it, derived from its payload when it was
   * appended; empty for an unkeyed Event. They are the index the scoped
   * compare-and-swap and keyed reads use, so a changed key function does not
   * change them.
   */
  readonly keys: Readonly<Record<string, string>>
}

/**
 * What a host supplies with one Event a Command emits, when it dispatches the
 * Command (`eventContext`): none of it reaches the decision, which happened
 * before.
 */
export type EventContext = {
  /** The Event's ID in place of one the Event Log generates; unique in the log. */
  readonly id?: string
  /**
   * When the Event was recorded, an ISO-8601 timestamp, in place of the Event
   * Log's clock: the host's clock at dispatch, for example.
   */
  readonly recordedAt?: string
  /**
   * Opaque to Specter: handed to the Event Log adapter with the Event's draft,
   * for a host's own adapter (its projections or hooks in the append). The
   * bundled adapters store none of it.
   */
  readonly metadata?: unknown
}

/**
 * A named key an Event carries: an identity of what it is about, such as its
 * aggregate's ID, under the name of that identity's kind (`session`,
 * `project`). Names keep ID spaces apart.
 */
export type EventKey = {
  readonly name: string
  readonly value: string
}

/**
 * Derives one named key from a payload: its value, or undefined when this
 * Event is about no identity of that name.
 */
export type EventKeyFunction<TPayload> = (
  payload: TPayload,
) => string | undefined

/** The named keys an Event type declares, each derived from the payload. */
export type EventKeyFunctions<TPayload> = Readonly<
  Record<string, EventKeyFunction<TPayload>>
>

export type EventDefinition<
  TType extends string = string,
  TPayload = unknown,
> = {
  readonly type: TType
  readonly schema: StandardSchemaV1
  readonly create: (payload: TPayload) => EventDraft<TType, TPayload>
  readonly decode: (payload: unknown) => Promise<TPayload>
  /**
   * The named keys an Event of this type carries: the identities of what it
   * is about, such as its aggregate's ID. Absent for an unkeyed Event type.
   */
  readonly keys?: EventKeyFunctions<TPayload>
}

export type EventDefinitionOptions<TPayload> = {
  /**
   * Declares the named keys an Event carries, each derived from its payload:
   * `{ session: (payload) => payload.sessionId }`. Core stores them with the
   * Event when it is appended. A Command that declares consistency keys
   * conflicts only with new Events carrying one of them, and a keyed Reaction
   * handles each value of its key a commit's Events carry.
   */
  readonly keys?: EventKeyFunctions<TPayload>
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
    ...(options.keys ? { keys: Object.freeze({ ...options.keys }) } : {}),
  }
}

/** Any Event Definition's key declarations, whatever its payload. */
type KeyedDefinition =
  | {
      readonly type: string
      readonly keys?: Readonly<Record<string, (payload: never) => unknown>>
    }
  | undefined

/** The key names an Event type declares, in declaration order. */
export function declaredKeyNames(
  definition: KeyedDefinition,
): readonly string[] {
  return definition?.keys ? Object.keys(definition.keys) : []
}

/**
 * The keys one Event carries, by name: a value for each name its type
 * declares, except those this payload has none for. Throws when a key
 * function returns anything but a string or undefined.
 */
export function eventKeys(
  definition: KeyedDefinition,
  payload: unknown,
): Readonly<Record<string, string>> {
  const keys: Record<string, string> = {}
  if (!definition?.keys) return keys
  for (const [name, derive] of Object.entries(definition.keys)) {
    const value: unknown = (derive as (payload: unknown) => unknown)(payload)
    if (value === undefined) continue
    if (typeof value !== 'string') {
      throw new TypeError(
        `Event "${definition.type}" key "${name}" must be a string or undefined.`,
      )
    }
    keys[name] = value
  }
  return keys
}
