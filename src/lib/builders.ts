import { Effect } from 'effect'
import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'
import type * as Schema from 'effect/Schema'

import type { EventDraft } from './event'
import type {
  CommandScenario,
  QueryScenario,
  ReactionScenario,
} from './testing'
import type {
  ApplyHandlers,
  CommandSlice,
  QuerySlice,
  ReactionPlugin,
  ReactionSlice,
  ViewCommandRef,
  ViewProps,
  ViewComponent,
  ViewQueryRef,
  ViewRegistration,
  ViewScenario,
} from './slice'
import { CommandRejectedError } from './registry'
import { createRuntimeView } from './view-runtime'
export { defineApplyHandlers } from './slice'

type MaybeEffect<T, E = unknown> = T | Effect.Effect<T, E, never>
type AnySchema = Schema.Schema.AnyNoContext
type SchemaType<TSchema extends AnySchema> = Schema.Schema.Type<TSchema>
type AnyApplyHandlers = ApplyHandlers

type CommandSchemaStep<TName extends string> = {
  schema: <TSchema extends AnySchema>(
    schema: TSchema,
  ) => CommandStep<TName, TSchema>
}

type CommandStep<TName extends string, TSchema extends AnySchema> = {
  handle: (
    handle: (
      db: SqliteRemoteDatabase,
      command: SchemaType<TSchema>,
    ) => MaybeEffect<EventDraft[]>,
  ) => CommandSlice<TName, TSchema> & { scenarios?: readonly CommandScenario[] }
  apply: <const TApply extends AnyApplyHandlers>(
    apply: TApply,
  ) => CommandApplyStep<TName, TSchema>
  scenarios: (
    ...scenarios: readonly CommandScenario<SchemaType<TSchema>>[]
  ) => CommandScenarioStep<TName, TSchema>
}

type CommandApplyStep<TName extends string, TSchema extends AnySchema> = {
  handle: CommandStep<TName, TSchema>['handle']
  scenarios: (
    ...scenarios: readonly CommandScenario<SchemaType<TSchema>>[]
  ) => {
    handle: CommandStep<TName, TSchema>['handle']
  }
}

type CommandScenarioStep<TName extends string, TSchema extends AnySchema> = {
  handle: CommandStep<TName, TSchema>['handle']
  apply: <const TApply extends AnyApplyHandlers>(
    apply: TApply,
  ) => {
    handle: CommandStep<TName, TSchema>['handle']
  }
}

type QuerySchemaStep<TName extends string> = {
  schema: <TSchema extends AnySchema>(
    schema: TSchema,
  ) => QueryApplyStep<TName, TSchema>
}

type QueryApplyStep<TName extends string, TSchema extends AnySchema> = {
  apply: <const TApply extends AnyApplyHandlers>(
    apply: TApply,
  ) => QueryHandleStep<TName, TSchema>
}

type QueryHandleStep<TName extends string, TSchema extends AnySchema> = {
  handle: <TResult>(
    handle: (
      input: SqliteRemoteDatabase,
      handle: SchemaType<TSchema>,
    ) => MaybeEffect<TResult>,
  ) => QuerySlice<TName, TSchema, TResult> & {
    scenarios?: readonly QueryScenario[]
  }
  scenarios: (
    ...scenarios: readonly QueryScenario<SchemaType<TSchema>>[]
  ) => QueryScenarioStep<TName, TSchema>
}

type QueryScenarioStep<TName extends string, TSchema extends AnySchema> = {
  handle: QueryHandleStep<TName, TSchema>['handle']
}

type ReactionStep<TName extends string, TPayload> = {
  payload: <TNextPayload>() => ReactionStep<TName, TNextPayload>
  plugin: (plugin: ReactionPlugin) => ReactionPluginStep<TName, TPayload>
  apply: <const TApply extends AnyApplyHandlers>(
    apply: TApply,
  ) => ReactionApplyStep<TName, TPayload>
  scenarios: (
    ...scenarios: readonly ReactionScenario<TPayload>[]
  ) => ReactionScenarioStep<TName, TPayload>
  handle: (
    handle: (db: SqliteRemoteDatabase) => MaybeEffect<TPayload | undefined>,
  ) => ReactionSlice<TName, TPayload> & {
    scenarios?: readonly ReactionScenario<TPayload>[]
  }
}

type ReactionPluginStep<TName extends string, TPayload> = {
  apply: ReactionStep<TName, TPayload>['apply']
  scenarios: ReactionStep<TName, TPayload>['scenarios']
  handle: ReactionStep<TName, TPayload>['handle']
}

type ReactionApplyStep<TName extends string, TPayload> = {
  plugin: ReactionStep<TName, TPayload>['plugin']
  scenarios: ReactionStep<TName, TPayload>['scenarios']
  handle: ReactionStep<TName, TPayload>['handle']
}

type ReactionScenarioStep<TName extends string, TPayload> = {
  plugin: ReactionStep<TName, TPayload>['plugin']
  apply: ReactionStep<TName, TPayload>['apply']
  handle: ReactionStep<TName, TPayload>['handle']
}

type ViewQueriesStep<TName extends string> = {
  queries: <TQueries extends Record<string, ViewQueryRef>>(
    queries: TQueries,
  ) => ViewTriggersStep<TName, TQueries>
}

type ViewTriggersStep<
  TName extends string,
  TQueries extends Record<string, ViewQueryRef>,
> = {
  triggers: <TTriggers extends Record<string, ViewCommandRef>>(
    triggers: TTriggers,
  ) => ViewScenariosStep<TName, TQueries, TTriggers>
}

type ViewScenariosStep<
  TName extends string,
  TQueries extends Record<string, ViewQueryRef>,
  TTriggers extends Record<string, ViewCommandRef>,
> = {
  scenarios: (
    scenarios: readonly ViewScenario<{
      [TKey in keyof TQueries]: TQueries[TKey] extends ViewQueryRef<
        infer TResult
      >
        ? TResult
        : never
    }>[],
  ) => ViewComponentStep<TName, TQueries, TTriggers>
}

type ViewComponentStep<
  TName extends string,
  TQueries extends Record<string, ViewQueryRef>,
  TTriggers extends Record<string, ViewCommandRef>,
> = {
  component: (
    component: ViewComponent<ViewProps<TQueries, TTriggers>>,
  ) => ViewRegistration<TName, TQueries, TTriggers>
}

export function rejectCommand(reason: string) {
  return Effect.fail(new CommandRejectedError({ reason }))
}

export function createCommandSlice<const TName extends string>(
  name: TName,
): CommandSchemaStep<TName> {
  return {
    schema: (schema) => {
      const createRegistration = (
        handle: (
          db: SqliteRemoteDatabase,
          command: SchemaType<typeof schema>,
        ) => MaybeEffect<EventDraft[]>,
        apply: AnyApplyHandlers,
        scenarios?: readonly CommandScenario[],
      ) => ({
        kind: 'command' as const,
        name,
        schema,
        apply,
        scenarios,
        handle: (
          db: SqliteRemoteDatabase,
          command: SchemaType<typeof schema>,
        ) => toEffect(() => handle(db, command)),
      })

      return {
        handle: (handle) => createRegistration(handle, {}),
        apply: (apply) => ({
          handle: (handle) => createRegistration(handle, apply),
          scenarios: (...scenarios) => ({
            handle: (handle) => createRegistration(handle, apply, scenarios),
          }),
        }),
        scenarios: (...scenarios) => ({
          handle: (handle) => createRegistration(handle, {}, scenarios),
          apply: (apply) => ({
            handle: (handle) => createRegistration(handle, apply, scenarios),
          }),
        }),
      }
    },
  }
}

export function createQuerySlice<const TName extends string>(
  name: TName,
): QuerySchemaStep<TName> {
  return {
    schema: (schema) => ({
      apply: (apply) => {
        const createRegistration = <TResult>(
          handle: (
            db: SqliteRemoteDatabase,
            query: SchemaType<typeof schema>,
          ) => MaybeEffect<TResult>,
          scenarios?: readonly QueryScenario[],
        ): QuerySlice<TName, typeof schema, TResult> & {
          scenarios?: readonly QueryScenario[]
        } => ({
          kind: 'query' as const,
          name,
          schema,
          apply,
          scenarios,
          handle: (
            db: SqliteRemoteDatabase,
            parsedQuery: SchemaType<typeof schema>,
          ) => toEffect(() => handle(db, parsedQuery)),
        })

        return {
          handle: (handle) => createRegistration(handle),
          scenarios: (...scenarios) => ({
            handle: (handle) => createRegistration(handle, scenarios),
          }),
        }
      },
    }),
  }
}

export function createReactionSlice<const TName extends string>(
  name: TName,
): ReactionStep<TName, import('./slice').CommandEnvelope> {
  return createReactionStep(name)
}

export function createView<const TName extends string>(
  name: TName,
): ViewQueriesStep<TName> {
  return {
    queries: (queries) => ({
      triggers: (triggers) => ({
        scenarios: (scenarios) => ({
          component: (component) => {
            const registration = {
              kind: 'view' as const,
              queries,
              triggers,
              scenarios,
              component,
            }
            const runtimeView = createRuntimeView({ name, ...registration })

            Object.defineProperty(runtimeView, 'name', {
              value: name,
              configurable: true,
            })

            return Object.assign(runtimeView, registration)
          },
        }),
      }),
    }),
  }
}

function createReactionStep<TName extends string, TPayload>(
  name: TName,
  plugin?: ReactionPlugin,
  apply?: AnyApplyHandlers,
  scenarios?: readonly ReactionScenario<TPayload>[],
): ReactionStep<TName, TPayload> {
  const createRegistration = (
    handle: (db: SqliteRemoteDatabase) => MaybeEffect<TPayload | undefined>,
  ) => ({
    kind: 'reaction' as const,
    name,
    apply: apply ?? {},
    plugin,
    scenarios,
    handle: (db: SqliteRemoteDatabase) => toEffect(() => handle(db)),
  })

  const s: ReactionStep<TName, TPayload> = {
    payload: <TNextPayload>() =>
      createReactionStep<TName, TNextPayload>(name, undefined, apply),
    plugin: (nextPlugin: ReactionPlugin) =>
      createReactionStep(name, nextPlugin, apply, scenarios),
    apply: (nextApply: ApplyHandlers) =>
      createReactionStep(name, plugin, nextApply, scenarios),
    scenarios: (...nextScenarios: readonly ReactionScenario<TPayload>[]) =>
      createReactionStep(name, plugin, apply, nextScenarios),
    handle: (
      handle: (db: SqliteRemoteDatabase) => MaybeEffect<TPayload | undefined>,
    ) => {
      const r = createRegistration(handle)
      return r
    },
  }

  return s
}

function toEffect<T, E>(
  run: () => MaybeEffect<T, E>,
): Effect.Effect<T, E, never> {
  return Effect.suspend(() => {
    const result = run()

    return Effect.isEffect(result) ? result : Effect.succeed(result)
  })
}
