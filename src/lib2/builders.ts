// biome-ignore-all lint/suspicious/noExplicitAny: builders preserve user callback service requirements.
import { Effect } from 'effect'
import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'
import type { z } from 'zod'

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
} from './slice'

type MaybeEffect<T> = T | Effect.Effect<T, unknown, any>

type CommandSchemaStep<TName extends string> = {
  schema: <TSchema extends z.ZodType>(
    schema: TSchema,
  ) => CommandStep<TName, TSchema>
}

type CommandStep<TName extends string, TSchema extends z.ZodType> = {
  handle: (
    handle: (
      db: SqliteRemoteDatabase,
      command: z.infer<TSchema>,
    ) => MaybeEffect<any[]>,
  ) => CommandSlice<TName, TSchema> & { scenarios?: readonly CommandScenario[] }
  apply: (apply: ApplyHandlers) => CommandApplyStep<TName, TSchema>
  scenarios: (
    ...scenarios: readonly CommandScenario<z.infer<TSchema>>[]
  ) => CommandScenarioStep<TName, TSchema>
}

type CommandApplyStep<TName extends string, TSchema extends z.ZodType> = {
  handle: CommandStep<TName, TSchema>['handle']
  scenarios: (...scenarios: readonly CommandScenario<z.infer<TSchema>>[]) => {
    handle: CommandStep<TName, TSchema>['handle']
  }
}

type CommandScenarioStep<TName extends string, TSchema extends z.ZodType> = {
  handle: CommandStep<TName, TSchema>['handle']
  apply: (apply: ApplyHandlers) => {
    handle: CommandStep<TName, TSchema>['handle']
  }
}

type ProjectionSchemaStep<TName extends string> = {
  schema: <TSchema extends z.ZodType>(
    schema: TSchema,
  ) => ProjectionApplyStep<TName, TSchema>
}

type ProjectionApplyStep<TName extends string, TSchema extends z.ZodType> = {
  apply: (apply: ApplyHandlers) => ProjectionQueryStep<TName, TSchema>
}

type ProjectionQueryStep<TName extends string, TSchema extends z.ZodType> = {
  handle: <TResult>(
    handle: (
      input: SqliteRemoteDatabase,
      handle: z.infer<TSchema>,
    ) => MaybeEffect<TResult>,
  ) => ProjectionSlice<TName, TSchema> & {
    scenarios?: readonly ProjectionScenario[]
  }
  scenarios: (
    ...scenarios: readonly ProjectionScenario<z.infer<TSchema>>[]
  ) => ProjectionScenarioStep<TName, TSchema>
}

type ProjectionScenarioStep<TName extends string, TSchema extends z.ZodType> = {
  handle: ProjectionQueryStep<TName, TSchema>['handle']
}

type ReactionStep<TName extends string, TPayload> = {
  payload: <TNextPayload>() => ReactionStep<TName, TNextPayload>
  plugin: (
    plugin: ReactionPlugin<TPayload>,
  ) => ReactionPluginStep<TName, TPayload>
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

export function createCommandSpec<const TName extends string>(
  name: TName,
): CommandSchemaStep<TName> {
  return {
    schema: (schema) => {
      const createRegistration = (
        handle: (
          db: SqliteRemoteDatabase,
          command: z.infer<typeof schema>,
        ) => MaybeEffect<any[]>,
        apply: ApplyHandlers,
        scenarios?: readonly CommandScenario[],
      ) => ({
        kind: 'command' as const,
        name,
        schema,
        apply,
        scenarios,
        handle: (db: SqliteRemoteDatabase, command: z.infer<typeof schema>) =>
          toEffect(() => handle(db, command)),
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
        const createRegistration = (
          handle: (
            db: SqliteRemoteDatabase,
            query: z.infer<typeof schema>,
          ) => MaybeEffect<unknown>,
          scenarios?: readonly ProjectionScenario[],
        ) => ({
          kind: 'projection' as const,
          name,
          schema,
          apply,
          scenarios,
          handle: (
            db: SqliteRemoteDatabase,
            parsedQuery: z.infer<typeof schema>,
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

function createReactionStep<TName extends string, TPayload>(
  name: TName,
  plugin?: ReactionPlugin<TPayload>,
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
    plugin: (nextPlugin: ReactionPlugin<TPayload>) =>
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
): Effect.Effect<T, unknown, any> {
  return Effect.suspend(() => {
    const result = run()

    return Effect.isEffect(result) ? result : Effect.succeed(result)
  })
}
