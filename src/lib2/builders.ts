import { Effect } from 'effect'
import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'
import type * as Schema from 'effect/Schema'

import type { Event } from './event'
import type {
  CommandScenario,
  ProjectionScenario,
  ReactionScenario,
} from './testing'
import type {
  ApplyHandlers,
  CommandSlice,
  ProjectionSlice,
  ReactionPlugin,
  ReactionSlice,
  ViewCommandRef,
  ViewProps,
  ViewComponent,
  ViewProjectionRef,
  ViewRegistration,
  ViewScenario,
} from './slice'

type MaybeEffect<T> = T | Effect.Effect<T, unknown, never>
type AnySchema = Schema.Schema.AnyNoContext
type SchemaType<TSchema extends AnySchema> = Schema.Schema.Type<TSchema>

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
    ) => MaybeEffect<Event[]>,
  ) => CommandSlice<TName, TSchema> & { scenarios?: readonly CommandScenario[] }
  apply: (apply: ApplyHandlers) => CommandApplyStep<TName, TSchema>
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
  apply: (apply: ApplyHandlers) => {
    handle: CommandStep<TName, TSchema>['handle']
  }
}

type ProjectionSchemaStep<TName extends string> = {
  schema: <TSchema extends AnySchema>(
    schema: TSchema,
  ) => ProjectionApplyStep<TName, TSchema>
}

type ProjectionApplyStep<TName extends string, TSchema extends AnySchema> = {
  apply: (apply: ApplyHandlers) => ProjectionQueryStep<TName, TSchema>
}

type ProjectionQueryStep<TName extends string, TSchema extends AnySchema> = {
  handle: <TResult>(
    handle: (
      input: SqliteRemoteDatabase,
      handle: SchemaType<TSchema>,
    ) => MaybeEffect<TResult>,
  ) => ProjectionSlice<TName, TSchema, TResult> & {
    scenarios?: readonly ProjectionScenario[]
  }
  scenarios: (
    ...scenarios: readonly ProjectionScenario<SchemaType<TSchema>>[]
  ) => ProjectionScenarioStep<TName, TSchema>
}

type ProjectionScenarioStep<TName extends string, TSchema extends AnySchema> = {
  handle: ProjectionQueryStep<TName, TSchema>['handle']
}

type ReactionStep<TName extends string, TPayload> = {
  payload: <TNextPayload>() => ReactionStep<TName, TNextPayload>
  plugin: (plugin: ReactionPlugin) => ReactionPluginStep<TName, TPayload>
  apply: (apply: ApplyHandlers) => ReactionApplyStep<TName, TPayload>
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
  queries: <TQueries extends Record<string, ViewProjectionRef>>(
    queries: TQueries,
  ) => ViewTriggersStep<TName, TQueries>
}

type ViewTriggersStep<
  TName extends string,
  TQueries extends Record<string, ViewProjectionRef>,
> = {
  triggers: <TTriggers extends Record<string, ViewCommandRef>>(
    triggers: TTriggers,
  ) => ViewScenariosStep<TName, TQueries, TTriggers>
}

type ViewScenariosStep<
  TName extends string,
  TQueries extends Record<string, ViewProjectionRef>,
  TTriggers extends Record<string, ViewCommandRef>,
> = {
  scenarios: (
    scenarios: readonly ViewScenario<{
      [TKey in keyof TQueries]: TQueries[TKey] extends ViewProjectionRef<
        infer TResult
      >
        ? TResult
        : never
    }>[],
  ) => ViewComponentStep<TName, TQueries, TTriggers>
}

type ViewComponentStep<
  TName extends string,
  TQueries extends Record<string, ViewProjectionRef>,
  TTriggers extends Record<string, ViewCommandRef>,
> = {
  component: (
    component: ViewComponent<ViewProps<TQueries, TTriggers>>,
  ) => ViewRegistration<TName, TQueries, TTriggers>
}

export function createCommandSpec<const TName extends string>(
  name: TName,
): CommandSchemaStep<TName> {
  return {
    schema: (schema) => {
      const createRegistration = (
        handle: (
          db: SqliteRemoteDatabase,
          command: SchemaType<typeof schema>,
        ) => MaybeEffect<Event[]>,
        apply: ApplyHandlers,
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

export function createProjectionSpec<const TName extends string>(
  name: TName,
): ProjectionSchemaStep<TName> {
  return {
    schema: (schema) => ({
      apply: (apply) => {
        const createRegistration = <TResult>(
          handle: (
            db: SqliteRemoteDatabase,
            query: SchemaType<typeof schema>,
          ) => MaybeEffect<TResult>,
          scenarios?: readonly ProjectionScenario[],
        ): ProjectionSlice<TName, typeof schema, TResult> & {
          scenarios?: readonly ProjectionScenario[]
        } => ({
          kind: 'projection' as const,
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

export function createReactionSpec<const TName extends string>(
  name: TName,
): ReactionStep<TName, import('./slice').CommandEnvelope> {
  return createReactionStep(name)
}

export function createViewSpec<const TName extends string>(
  name: TName,
): ViewQueriesStep<TName> {
  return {
    queries: (queries) => ({
      triggers: (triggers) => ({
        scenarios: (scenarios) => ({
          component: (component) => ({
            kind: 'view' as const,
            name,
            queries,
            triggers,
            scenarios,
            component,
          }),
        }),
      }),
    }),
  }
}

function createReactionStep<TName extends string, TPayload>(
  name: TName,
  plugin?: ReactionPlugin,
  apply?: ApplyHandlers,
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

function toEffect<T>(
  run: () => MaybeEffect<T>,
): Effect.Effect<T, unknown, never> {
  return Effect.suspend(() => {
    const result = run()

    return Effect.isEffect(result) ? result : Effect.succeed(result)
  })
}
