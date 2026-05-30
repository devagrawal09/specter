import type { StandardSchemaV1 } from '@standard-schema/spec'

import type { SliceStoreAdapter } from '../adapters/contracts'
import type { Event, EventDefinition, EventDraft } from './event'
export type {
  EventLogAdapter,
  SliceStore,
  SliceStoreAdapter,
} from '../adapters/contracts'

export type ApplyEventDefinition<
  TType extends string = string,
  TPayload = unknown,
> = Pick<EventDefinition<TType, TPayload>, 'type' | 'decode'>
export type RejectedCommand = {
  readonly reason: string
}

export type CommandEnvelope<
  TName extends string = string,
  TPayload = unknown,
> = {
  type: TName
  payload: TPayload
}

type EventType<TEventDefinition> = TEventDefinition extends {
  type: infer TType extends string
}
  ? TType
  : never

type EventPayloadForType<TEventDefinition, TType extends string> =
  TEventDefinition extends ApplyEventDefinition<TType, infer TPayload>
    ? TPayload
    : never

type EventForType<
  TEventDefinitions extends readonly ApplyEventDefinition[],
  TType extends string,
> = Event<TType, EventPayloadForType<TEventDefinitions[number], TType>>

type ApplyHandler<TEvent extends Event, TState = unknown> = {
  bivarianceHack(event: TEvent, state: TState): Promise<void>
}['bivarianceHack']

export type ApplyHandlers<
  TEventDefinitions extends
    readonly ApplyEventDefinition[] = readonly ApplyEventDefinition[],
  TState = unknown,
> = Partial<{
  [TType in EventType<TEventDefinitions[number]>]: ApplyHandler<
    EventForType<TEventDefinitions, TType>,
    TState
  >
}>

export function defineApplyHandlers<
  const TEventDefinitions extends readonly ApplyEventDefinition[],
>(
  _eventDefinitions: TEventDefinitions,
  apply: ApplyHandlers<TEventDefinitions>,
): ApplyHandlers<TEventDefinitions> {
  return apply
}

type AnyApplyHandlers<TState = unknown> = ApplyHandlers<
  readonly ApplyEventDefinition[],
  TState
>

export type CommandSlice<
  TName extends string = string,
  TSchema extends StandardSchemaV1 = StandardSchemaV1,
  TWriteState = unknown,
  TReadState = TWriteState,
  TRequirements = unknown,
> = {
  kind: 'command'
  name: TName
  description: string
  schema: TSchema
  store: SliceStoreAdapter<TWriteState, TReadState, TRequirements>
  apply: AnyApplyHandlers<TWriteState>
  scenarios?: readonly unknown[]
  handle: (
    command: StandardSchemaV1.InferOutput<TSchema>,
    state: TReadState,
  ) => Promise<EventDraft[]>
}

export type QuerySlice<
  TName extends string = string,
  TSchema extends StandardSchemaV1 = StandardSchemaV1,
  TResult = unknown,
  TWriteState = unknown,
  TReadState = TWriteState,
  TRequirements = unknown,
> = {
  kind: 'query'
  name: TName
  description: string
  schema: TSchema
  store: SliceStoreAdapter<TWriteState, TReadState, TRequirements>
  apply: AnyApplyHandlers<TWriteState>
  scenarios?: readonly unknown[]
  handle: (
    query: StandardSchemaV1.InferOutput<TSchema>,
    state: TReadState,
  ) => Promise<TResult>
}

export type QueryRef<TRegistration> =
  TRegistration extends QuerySlice<infer TName, infer TSchema, infer TResult>
    ? {
        name: TName
        result?: TResult
        input?: StandardSchemaV1.InferOutput<TSchema>
      }
    : never

export type CommandRef<TRegistration> =
  TRegistration extends CommandSlice<infer TName, infer TSchema>
    ? { name: TName; payload?: StandardSchemaV1.InferOutput<TSchema> }
    : never

export type CommandDispatch = (command: CommandEnvelope) => Promise<void>

export type ReactionExec = (reaction: unknown) => Promise<unknown>

export type ReactionPlugin = (command: CommandDispatch) => Promise<ReactionExec>

export type ReactionSlice<
  TName extends string = string,
  TPayload = CommandEnvelope,
  TWriteState = unknown,
  TReadState = TWriteState,
  TRequirements = unknown,
> = {
  kind: 'reaction'
  name: TName
  description: string
  store: SliceStoreAdapter<TWriteState, TReadState, TRequirements>
  apply: AnyApplyHandlers<TWriteState>
  plugin: ReactionPlugin
  scenarios?: readonly unknown[]
  handle: (state: TReadState) => Promise<TPayload | undefined>
}

type AnyCommandSlice = Omit<
  CommandSlice<string, StandardSchemaV1, unknown, unknown, unknown>,
  'handle'
> & {
  handle: {
    bivarianceHack(command: unknown, state: unknown): Promise<EventDraft[]>
  }['bivarianceHack']
}

type AnyQuerySlice = Omit<
  QuerySlice<string, StandardSchemaV1, unknown, unknown, unknown, unknown>,
  'handle'
> & {
  handle: {
    bivarianceHack(query: unknown, state: unknown): Promise<unknown>
  }['bivarianceHack']
}

type AnyReactionSlice = Omit<
  ReactionSlice<string, unknown, unknown, unknown, unknown>,
  'handle'
> & {
  handle: {
    bivarianceHack(state: unknown): Promise<unknown | undefined>
  }['bivarianceHack']
}

export type SliceRegistration =
  | AnyCommandSlice
  | AnyQuerySlice
  | AnyReactionSlice
