import type { StandardSchemaV1 } from '@standard-schema/spec'

import type { EventDraft } from './event'
import type {
  CommandScenario,
  QueryScenario,
  ReactionScenario,
} from './testing'
import type {
  ApplyHandlers,
  ApplyEventDefinition,
  CommandSlice,
  QuerySlice,
  ReactionPlugin,
  ReactionSlice,
  SliceStoreAdapter,
} from './slice'
import { CommandRejectedError } from './errors'
export { defineApplyHandlers } from './slice'

type AnyApplyHandlers<TState = unknown> = ApplyHandlers<
  readonly ApplyEventDefinition[],
  TState
>

type CommandSchemaStep<TName extends string> = {
  schema: <TSchema extends StandardSchemaV1>(
    schema: TSchema,
  ) => CommandStoreStep<TName, TSchema>
}

type CommandStoreStep<
  TName extends string,
  TSchema extends StandardSchemaV1,
> = {
  store: <TWriteState, TReadState = TWriteState>(
    store: SliceStoreAdapter<TWriteState, TReadState>,
  ) => CommandStep<TName, TSchema, TWriteState, TReadState>
}

type CommandStep<
  TName extends string,
  TSchema extends StandardSchemaV1,
  TWriteState,
  TReadState,
> = {
  handle: (
    handle: (
      command: StandardSchemaV1.InferOutput<TSchema>,
      state: TReadState,
    ) => Promise<EventDraft[]>,
  ) => CommandSlice<TName, TSchema, TWriteState, TReadState> & {
    scenarios?: readonly CommandScenario[]
  }
  apply: (
    apply: AnyApplyHandlers<TWriteState>,
  ) => CommandApplyStep<TName, TSchema, TWriteState, TReadState>
  scenarios: (
    ...scenarios: readonly CommandScenario<
      StandardSchemaV1.InferOutput<TSchema>
    >[]
  ) => CommandScenarioStep<TName, TSchema, TWriteState, TReadState>
}

type CommandApplyStep<
  TName extends string,
  TSchema extends StandardSchemaV1,
  TWriteState,
  TReadState,
> = {
  handle: CommandStep<TName, TSchema, TWriteState, TReadState>['handle']
  scenarios: (
    ...scenarios: readonly CommandScenario<
      StandardSchemaV1.InferOutput<TSchema>
    >[]
  ) => {
    handle: CommandStep<TName, TSchema, TWriteState, TReadState>['handle']
  }
}

type CommandScenarioStep<
  TName extends string,
  TSchema extends StandardSchemaV1,
  TWriteState,
  TReadState,
> = {
  handle: CommandStep<TName, TSchema, TWriteState, TReadState>['handle']
  apply: (apply: AnyApplyHandlers<TWriteState>) => {
    handle: CommandStep<TName, TSchema, TWriteState, TReadState>['handle']
  }
}

type QuerySchemaStep<TName extends string> = {
  schema: <TSchema extends StandardSchemaV1>(
    schema: TSchema,
  ) => QueryStoreStep<TName, TSchema>
}

type QueryStoreStep<TName extends string, TSchema extends StandardSchemaV1> = {
  store: <TWriteState, TReadState = TWriteState>(
    store: SliceStoreAdapter<TWriteState, TReadState>,
  ) => QueryApplyStep<TName, TSchema, TWriteState, TReadState>
}

type QueryApplyStep<
  TName extends string,
  TSchema extends StandardSchemaV1,
  TWriteState,
  TReadState,
> = {
  apply: (
    apply: AnyApplyHandlers<TWriteState>,
  ) => QueryHandleStep<TName, TSchema, TWriteState, TReadState>
}

type QueryHandleStep<
  TName extends string,
  TSchema extends StandardSchemaV1,
  TWriteState,
  TReadState,
> = {
  handle: <TResult>(
    handle: (
      input: StandardSchemaV1.InferOutput<TSchema>,
      state: TReadState,
    ) => Promise<TResult>,
  ) => QuerySlice<TName, TSchema, TResult, TWriteState, TReadState> & {
    scenarios?: readonly QueryScenario[]
  }
  scenarios: (
    ...scenarios: readonly QueryScenario<
      StandardSchemaV1.InferOutput<TSchema>
    >[]
  ) => QueryScenarioStep<TName, TSchema, TWriteState, TReadState>
}

type QueryScenarioStep<
  TName extends string,
  TSchema extends StandardSchemaV1,
  TWriteState,
  TReadState,
> = {
  handle: QueryHandleStep<TName, TSchema, TWriteState, TReadState>['handle']
}

type ReactionStep<TName extends string, TPayload> = {
  payload: <TNextPayload>() => ReactionStep<TName, TNextPayload>
  plugin: (plugin: ReactionPlugin) => ReactionStoreStep<TName, TPayload>
}

type ReactionStoreStep<TName extends string, TPayload> = {
  store: <TWriteState, TReadState = TWriteState>(
    store: SliceStoreAdapter<TWriteState, TReadState>,
  ) => ReactionConfiguredStep<TName, TPayload, TWriteState, TReadState>
}

type ReactionConfiguredStep<
  TName extends string,
  TPayload,
  TWriteState,
  TReadState,
> = {
  apply: (
    apply: AnyApplyHandlers<TWriteState>,
  ) => ReactionApplyStep<TName, TPayload, TWriteState, TReadState>
  scenarios: (
    ...scenarios: readonly ReactionScenario<TPayload>[]
  ) => ReactionScenarioStep<TName, TPayload, TWriteState, TReadState>
}

type ReactionApplyStep<
  TName extends string,
  TPayload,
  TWriteState,
  TReadState,
> = {
  handle: ReactionHandle<TName, TPayload, TWriteState, TReadState>
  scenarios: ReactionConfiguredStep<
    TName,
    TPayload,
    TWriteState,
    TReadState
  >['scenarios']
}

type ReactionScenarioStep<
  TName extends string,
  TPayload,
  TWriteState,
  TReadState,
> = {
  apply: ReactionConfiguredStep<
    TName,
    TPayload,
    TWriteState,
    TReadState
  >['apply']
  handle: ReactionHandle<TName, TPayload, TWriteState, TReadState>
}

type ReactionHandle<TName extends string, TPayload, TWriteState, TReadState> = (
  handle: (state: TReadState) => Promise<TPayload | undefined>,
) => ReactionSlice<TName, TPayload, TWriteState, TReadState> & {
  scenarios?: readonly ReactionScenario<TPayload>[]
}

export function rejectCommand(reason: string) {
  throw new CommandRejectedError({ reason })
}

export function createCommandSlice<const TName extends string>(
  name: TName,
): CommandSchemaStep<TName> {
  return {
    schema: (schema) => {
      const withStore = <TWriteState, TReadState>(
        store: SliceStoreAdapter<TWriteState, TReadState>,
      ) => {
        const createRegistration = (
          handle: (
            command: StandardSchemaV1.InferOutput<typeof schema>,
            state: TReadState,
          ) => Promise<EventDraft[]>,
          apply: AnyApplyHandlers<TWriteState>,
          scenarios?: readonly CommandScenario[],
        ) => ({
          kind: 'command' as const,
          name,
          schema,
          store,
          apply,
          scenarios,
          handle,
        })

        return {
          handle: (handle) => createRegistration(handle, {}),
          apply: (apply: AnyApplyHandlers<TWriteState>) => ({
            handle: (handle) => createRegistration(handle, apply),
            scenarios: (...scenarios) => ({
              handle: (handle) => createRegistration(handle, apply, scenarios),
            }),
          }),
          scenarios: (...scenarios) => ({
            handle: (handle) => createRegistration(handle, {}, scenarios),
            apply: (apply: AnyApplyHandlers<TWriteState>) => ({
              handle: (handle) => createRegistration(handle, apply, scenarios),
            }),
          }),
        } satisfies CommandStep<TName, typeof schema, TWriteState, TReadState>
      }

      return { store: withStore }
    },
  }
}

export function createQuerySlice<const TName extends string>(
  name: TName,
): QuerySchemaStep<TName> {
  return {
    schema: (schema) => ({
      store: <TWriteState, TReadState = TWriteState>(
        store: SliceStoreAdapter<TWriteState, TReadState>,
      ) => ({
        apply: (apply: AnyApplyHandlers<TWriteState>) => {
          const createRegistration = <TResult>(
            handle: (
              query: StandardSchemaV1.InferOutput<typeof schema>,
              state: TReadState,
            ) => Promise<TResult>,
            scenarios?: readonly QueryScenario[],
          ): QuerySlice<
            TName,
            typeof schema,
            TResult,
            TWriteState,
            TReadState
          > & {
            scenarios?: readonly QueryScenario[]
          } => ({
            kind: 'query' as const,
            name,
            schema,
            store,
            apply,
            scenarios,
            handle,
          })

          return {
            handle: (handle) => createRegistration(handle),
            scenarios: (...scenarios) => ({
              handle: (handle) => createRegistration(handle, scenarios),
            }),
          } satisfies QueryHandleStep<
            TName,
            typeof schema,
            TWriteState,
            TReadState
          >
        },
      }),
    }),
  }
}

export function createReactionSlice<const TName extends string>(
  name: TName,
): ReactionStep<TName, import('./slice').CommandEnvelope> {
  return createReactionStep(name)
}

function createReactionStep<TName extends string, TPayload>(
  name: TName,
  scenarios?: readonly ReactionScenario<TPayload>[],
): ReactionStep<TName, TPayload> {
  const s: ReactionStep<TName, TPayload> = {
    payload: <TNextPayload>() => createReactionStep<TName, TNextPayload>(name),
    plugin: (nextPlugin: ReactionPlugin) =>
      createReactionStoreStep(name, nextPlugin, scenarios),
  }

  return s
}

function createReactionStoreStep<TName extends string, TPayload>(
  name: TName,
  plugin: ReactionPlugin,
  scenarios?: readonly ReactionScenario<TPayload>[],
): ReactionStoreStep<TName, TPayload> {
  return {
    store: <TWriteState, TReadState = TWriteState>(
      store: SliceStoreAdapter<TWriteState, TReadState>,
    ) => {
      const configured = (
        apply: AnyApplyHandlers<TWriteState> = {},
      ): ReactionConfiguredStep<TName, TPayload, TWriteState, TReadState> &
        ReactionApplyStep<TName, TPayload, TWriteState, TReadState> => {
        const handle: ReactionHandle<
          TName,
          TPayload,
          TWriteState,
          TReadState
        > = (handler) => ({
          kind: 'reaction' as const,
          name,
          store,
          apply,
          plugin,
          scenarios,
          handle: handler,
        })

        return {
          apply: (nextApply: ApplyHandlers) => configured(nextApply),
          scenarios: (
            ...nextScenarios: readonly ReactionScenario<TPayload>[]
          ) => ({
            apply: (nextApply: ApplyHandlers) =>
              createReactionStoreStep(name, plugin, nextScenarios)
                .store(store)
                .apply(nextApply),
            handle: createReactionStoreStep(name, plugin, nextScenarios)
              .store(store)
              .apply(apply).handle,
          }),
          handle,
        }
      }

      return configured()
    },
  }
}
