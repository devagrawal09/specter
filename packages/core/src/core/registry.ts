import type { StandardSchemaV1 } from '@standard-schema/spec'

import type { EventLogAdapter, SliceStore } from '../adapters/contracts'
import type { EventDraft, PersistedEvent } from './event'
import type { MaybePromise } from './maybe-promise'
import {
  allMaybePromises,
  flatMapMaybePromise,
  forEachMaybePromise,
  mapMaybePromise,
} from './maybe-promise'
import { decodeSchema } from './schema'
import type {
  CommandEnvelope,
  CommandSlice,
  QuerySlice,
  ReactionExec,
  ReactionSlice,
  SliceRegistration,
} from './slice'

export type SpecterAppConfig = {
  readonly events: readonly {
    readonly type: string
    readonly decode: (payload: unknown) => MaybePromise<unknown>
  }[]
  readonly eventLog: EventLogAdapter
  readonly slices: readonly SliceRegistration[]
}

type CommandInput<TSlice> =
  TSlice extends CommandSlice<string, infer TSchema>
    ? StandardSchemaV1.InferOutput<TSchema>
    : never

type QueryInput<TSlice> =
  TSlice extends QuerySlice<string, infer TSchema>
    ? StandardSchemaV1.InferOutput<TSchema>
    : never

type QueryOutput<TSlice> =
  TSlice extends QuerySlice<string, infer _TSchema, infer TResult>
    ? TResult
    : never

type CommandMethods<TSlices extends readonly SliceRegistration[]> = {
  [TSlice in Extract<TSlices[number], { kind: 'command' }> as TSlice['name']]: (
    input: CommandInput<TSlice>,
  ) => MaybePromise<void>
}

type QueryMethods<TSlices extends readonly SliceRegistration[]> = {
  [TSlice in Extract<TSlices[number], { kind: 'query' }> as TSlice['name']]: (
    input: QueryInput<TSlice>,
  ) => MaybePromise<QueryOutput<TSlice>>
}

export type SpecterApp<TConfig extends SpecterAppConfig> = CommandMethods<
  TConfig['slices']
> &
  QueryMethods<TConfig['slices']> & {
    readonly runtime: {
      runReactions: () => MaybePromise<boolean>
    }
  }

type PreparedReactionEffect = {
  readonly reaction: ReactionSlice<string, unknown>
  readonly exec: ReactionExec
  readonly effect: unknown
}

export function createSpecterApp<const TConfig extends SpecterAppConfig>(
  config: TConfig,
): SpecterApp<TConfig> {
  const eventDefinitions: Record<
    string,
    {
      readonly type: string
      readonly decode: (payload: unknown) => MaybePromise<unknown>
    }
  > = {}

  for (const eventDefinition of config.events) {
    if (eventDefinitions[eventDefinition.type]) {
      throw new Error(`Duplicate event type: ${eventDefinition.type}`)
    }

    eventDefinitions[eventDefinition.type] = eventDefinition
  }

  const slicesByKind: {
    commands: Record<string, CommandSlice>
    queries: Record<string, QuerySlice>
    reactions: Record<string, ReactionSlice<string, unknown>>
  } = { commands: {}, queries: {}, reactions: {} }
  const sliceNames = new Set<string>()

  for (const registration of config.slices) {
    if (sliceNames.has(registration.name)) {
      throw new Error(`Duplicate slice name: ${registration.name}`)
    }

    sliceNames.add(registration.name)

    switch (registration.kind) {
      case 'command':
        slicesByKind.commands[registration.name] = registration
        break
      case 'query':
        slicesByKind.queries[registration.name] = registration
        break
      case 'reaction':
        slicesByKind.reactions[registration.name] = registration
        break
    }
  }

  if (Object.keys(slicesByKind.commands).length === 0) {
    throw new Error('At least one command slice must be registered')
  }

  for (const registration of config.slices) {
    for (const eventType of Object.keys(registration.apply ?? {})) {
      if (!eventDefinitions[eventType]) {
        throw new Error(`Unknown event type: ${eventType}`)
      }
    }
  }

  const reactionExecs = new Map<string, ReactionExec>()
  const app: Record<string, unknown> = { runtime: { runReactions } }

  for (const command of Object.values(slicesByKind.commands)) {
    app[command.name] = (input: unknown) => runCommand(command, input)
  }

  for (const query of Object.values(slicesByKind.queries)) {
    app[query.name] = (input: unknown) => runQuery(query, input)
  }

  return app as SpecterApp<TConfig>

  function decodePersistedEvent(event: PersistedEvent) {
    const eventDefinition = eventDefinitions[event.type]
    if (!eventDefinition) throw new Error(`Unknown event type: ${event.type}`)

    return mapMaybePromise(
      eventDefinition.decode(event.payload),
      (payload) => ({
        ...event,
        payload,
      }),
    )
  }

  function decodeEventDraft(event: EventDraft) {
    const eventDefinition = eventDefinitions[event.type]
    if (!eventDefinition) throw new Error(`Unknown event type: ${event.type}`)

    return mapMaybePromise(
      eventDefinition.decode(event.payload),
      (payload) => ({
        ...event,
        payload,
      }),
    )
  }

  function catchUpSlice(
    slice: SliceRegistration,
    store: SliceStore,
    eventLog: EventLogAdapter = config.eventLog,
  ) {
    const eventTypes = Object.keys(slice.apply ?? {})

    if (!eventTypes.length) return { store, advanced: false } as const

    return flatMapMaybePromise(store.lastAppliedOrder(), (lastAppliedOrder) =>
      flatMapMaybePromise(
        eventLog.query(lastAppliedOrder, eventTypes),
        (unreadEvents) =>
          flatMapMaybePromise(
            allMaybePromises(unreadEvents.map(decodePersistedEvent)),
            (unappliedEvents) => {
              if (!unappliedEvents.length) {
                return { store, advanced: false } as const
              }

              return flatMapMaybePromise(
                applyEvents(slice, store, unappliedEvents),
                () => {
                  const lastEvent = unappliedEvents[unappliedEvents.length - 1]

                  return mapMaybePromise(
                    store.setLastAppliedOrder(lastEvent.order),
                    () => ({ store, advanced: true }) as const,
                  )
                },
              )
            },
          ),
      ),
    )
  }

  function applyEvents(
    slice: SliceRegistration,
    store: SliceStore,
    events: readonly PersistedEvent[],
  ) {
    return forEachMaybePromise(events, (event) => {
      const apply = slice.apply[event.type]

      return apply ? apply(event, store.write) : undefined
    })
  }

  function runCommand(commandSlice: CommandSlice, input: unknown) {
    return commandSlice.store.transaction(commandSlice.name, (store) => {
      return config.eventLog.transaction((eventLog) =>
        flatMapMaybePromise(
          decodeSchema(commandSlice.schema, input),
          (parsedCommand) =>
            flatMapMaybePromise(
              catchUpSlice(commandSlice, store, eventLog),
              () =>
                flatMapMaybePromise(
                  commandSlice.handle(parsedCommand, store.read),
                  (events) =>
                    flatMapMaybePromise(
                      allMaybePromises(events.map(decodeEventDraft)),
                      (decodedEvents) =>
                        mapMaybePromise(
                          eventLog.append(decodedEvents),
                          () => undefined,
                        ),
                    ),
                ),
            ),
        ),
      )
    })
  }

  function runQuery(query: QuerySlice, input: unknown) {
    return query.store.transaction(query.name, (store) =>
      flatMapMaybePromise(decodeSchema(query.schema, input), (parsedInput) =>
        flatMapMaybePromise(catchUpSlice(query, store), () =>
          query.handle(parsedInput, store.read),
        ),
      ),
    )
  }

  function dispatch(c: CommandEnvelope) {
    const command = slicesByKind.commands[c.type]
    if (!command) throw new Error(`Unknown command: ${c.type}`)

    return runCommand(command, c.payload)
  }

  function getReactionExec(reaction: ReactionSlice<string, unknown>) {
    const cachedExec = reactionExecs.get(reaction.name)
    if (cachedExec) return cachedExec

    return mapMaybePromise(reaction.plugin(dispatch), (exec) => {
      reactionExecs.set(reaction.name, exec)
      return exec
    })
  }

  function runReactions() {
    const runnableEffects: PreparedReactionEffect[] = []

    return flatMapMaybePromise(
      forEachMaybePromise(Object.values(slicesByKind.reactions), (reaction) =>
        mapMaybePromise(
          reaction.store.transaction(reaction.name, (store) =>
            flatMapMaybePromise(
              catchUpSlice(reaction, store),
              ({ advanced }) => {
                if (!advanced) return undefined

                return flatMapMaybePromise(
                  reaction.handle(store.read),
                  (effect) => {
                    if (effect === undefined) return undefined

                    return mapMaybePromise(
                      getReactionExec(reaction),
                      (exec) =>
                        ({
                          reaction,
                          exec,
                          effect,
                        }) satisfies PreparedReactionEffect,
                    )
                  },
                )
              },
            ),
          ),
          (preparedEffect) => {
            if (preparedEffect) runnableEffects.push(preparedEffect)
          },
        ),
      ),
      () =>
        mapMaybePromise(
          forEachMaybePromise(runnableEffects, ({ exec, effect }) =>
            mapMaybePromise(exec(effect), () => undefined),
          ),
          () => runnableEffects.length > 0,
        ),
    )
  }
}
