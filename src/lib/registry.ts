import { and, asc, eq, gt } from 'drizzle-orm'
import { z } from 'zod'

import type { StoreTx } from '.'
import type { Event } from '../features/events'
import { events as eventTable, sliceCursors, sliceJsonStates } from '.'
export {
  createCommandSpec as createCommandSlice,
  createProjectionSpec as createProjectionSlice,
  createReactionSpec as createReactionSlice,
  createViewSpec,
} from './registry.builders'
export type {
  AnyCommandRegistration,
  AnyProjectionRegistration,
  AnyReactionRegistration,
  ApplyHandlers,
  CommandRegistration,
  CommandEnvelope,
  CommandSliceSchemaStep,
  JsonApplyHandlers,
  JsonCommandRegistration,
  JsonProjectionRegistration,
  JsonReactionRegistration,
  ProjectionRegistration,
  ProjectionScenario,
  ProjectionSliceSchemaStep,
  ReactionRegistration,
  ReactionSliceApplyStep,
  ReactionSliceReactStep,
  SliceOptions,
  SliceRegistration,
  ViewScenario,
} from './registry.builders'
import type {
  AnyCommandRegistration,
  AnyProjectionRegistration,
  AnyReactionRegistration,
  JsonReadStore,
  JsonWriteStore,
  SliceRegistration,
} from './registry.builders'
import { addTodo } from '../features/todos-json/add-todo/slice'
import {
  completeHarlanScriptExecution,
  failHarlanScriptExecution,
} from '../features/harlan/runtime/complete-script-execution/slice'
import { executeHarlanScript } from '../features/harlan/runtime/execute-script/slice'
import { saveHarlanExecutionContext } from '../features/harlan/runtime/save-execution-context/slice'
import { saveHarlanExecutionContextAfterCompletion } from '../features/harlan/runtime/save-execution-context-reaction/slice'
import { changeTodoCompletion } from '../features/todos-json/change-todo-completion/slice'
import { createTodoCheer } from '../features/todos-json/create-todo-cheer/slice'
import { removeTodo } from '../features/todos-json/remove-todo/slice'
import { todoCheers } from '../features/todos-json/todo-cheers/slice'
import { todoCompletionCheer } from '../features/todos-json/todo-completion-cheer-reaction/slice'
import { todosProjection } from '../features/todos-json/todos-view/slice'

const maxReactionCascadeRounds = 10

export const sliceRegistrations = [
  addTodo,
  changeTodoCompletion,
  removeTodo,
  createTodoCheer,
  executeHarlanScript,
  completeHarlanScriptExecution,
  failHarlanScriptExecution,
  saveHarlanExecutionContext,
  saveHarlanExecutionContextAfterCompletion,
  todoCompletionCheer,
  todosProjection,
  todoCheers,
] as const satisfies readonly SliceRegistration[]

assertUniqueRegistrations(sliceRegistrations)

const commandRegistrations = collectCommandRegistrations(sliceRegistrations)
export const projectionRegistrations =
  collectProjectionRegistrations(sliceRegistrations)
const reactionRegistrations = collectReactionRegistrations(sliceRegistrations)
const eventApplications = collectEventApplications(sliceRegistrations)

if (commandRegistrations.length === 0) {
  throw new Error('Registry must include at least one command slice')
}

const commandSchemas = commandRegistrations.map((command) =>
  z.object({ type: z.literal(command.type), payload: command.schema }),
)

export const commandInput = z.discriminatedUnion('type', [
  commandSchemas[0],
  ...commandSchemas.slice(1),
])

export type Command = z.infer<typeof commandInput>

export function decideCommand(command: Command, tx: StoreTx): Event[] {
  const registration = commandRegistrations.find(
    (candidate) => candidate.type === command.type,
  )

  if (!registration) {
    throw new Error(`Unknown command: ${command.type}`)
  }

  if (registration.apply) {
    catchUpSliceState(registration, tx)
  }

  if (registration.json) {
    catchUpSliceState(registration, tx)

    return registration.decide(
      command.payload as never,
      createJsonReadStore(registration.type, tx),
    )
  }

  return registration.decide(command.payload as never, tx)
}

export function dispatchCommandInTx(command: Command, tx: StoreTx): Event[] {
  const producedEvents: Event[] = []
  let pendingCommands = [command]
  let round = 0

  while (pendingCommands.length > 0) {
    round += 1

    if (round > maxReactionCascadeRounds) {
      throw new Error(
        `Reaction cascade exceeded ${maxReactionCascadeRounds} rounds`,
      )
    }

    const nextCommands: Command[] = []

    for (const pendingCommand of pendingCommands) {
      const events = decideCommand(pendingCommand, tx)
      producedEvents.push(...events)

      if (events.length === 0) {
        continue
      }

      const persistedEvents = persistEvents(events, tx)
      applyEagerSlices(persistedEvents, tx)

      const notifiedReactions = new Set<AnyReactionRegistration>()

      for (const event of persistedEvents) {
        for (const reaction of reactionRegistrations) {
          if (!reaction.apply?.[event.type]) {
            continue
          }

          notifiedReactions.add(reaction)
        }
      }

      for (const reaction of notifiedReactions) {
        const reactionCommands = reactWithState(reaction, tx)

        for (const reactionCommand of reactionCommands) {
          nextCommands.push(commandInput.parse(reactionCommand))
        }
      }
    }

    pendingCommands = nextCommands
  }

  return producedEvents
}

export function applyEvents(events: Event[], tx: StoreTx) {
  for (const event of events) {
    const handlers = eventApplications[event.type]

    if (!handlers) {
      continue
    }

    for (const handler of handlers) {
      handler(event, tx)
    }
  }
}

export function queryProjection(
  registration: AnyProjectionRegistration,
  input: unknown,
  tx: StoreTx,
) {
  if (registration.apply) {
    catchUpSliceState(registration, tx)
  }

  if (registration.json) {
    return registration.query(
      createJsonReadStore(registration.name, tx),
      input as never,
    )
  }

  return registration.query(tx, input as never)
}

export function reactToEvent(
  registration: AnyReactionRegistration,
  _event: Event,
  tx: StoreTx,
) {
  catchUpSliceState(registration, tx)

  if (registration.json) {
    return registration.react(createJsonReadStore(registration.name, tx))
  }

  return registration.react(tx)
}

function reactWithState(registration: AnyReactionRegistration, tx: StoreTx) {
  catchUpSliceState(registration, tx)

  if (registration.json) {
    return registration.react(createJsonReadStore(registration.name, tx))
  }

  return registration.react(tx)
}

function catchUpSliceState(registration: SliceRegistration, tx: StoreTx) {
  if (!('apply' in registration) || !registration.apply) {
    return
  }

  const sliceName = sliceRegistrationName(registration)
  const cursor = tx
    .select()
    .from(sliceCursors)
    .where(eq(sliceCursors.sliceName, sliceName))
    .get()
  const lastAppliedOrder = cursor?.lastAppliedOrder ?? 0
  const persistedEvents = tx
    .select()
    .from(eventTable)
    .where(gt(eventTable.order, lastAppliedOrder))
    .orderBy(asc(eventTable.order))
    .all()

  for (const event of persistedEvents) {
    applyEventToSlice(
      registration,
      {
        id: event.id,
        type: event.type,
        payload: JSON.parse(event.payload),
      } as Event,
      event.order,
      tx,
    )
  }
}

function applyEventToSlice(
  registration: SliceRegistration,
  event: Event,
  eventOrder: number | undefined,
  tx: StoreTx,
) {
  if (!('apply' in registration) || !registration.apply) {
    return
  }

  const sliceName = sliceRegistrationName(registration)

  if (registration.json) {
    const handler = registration.apply?.[event.type] as
      | ((event: Event, store: JsonWriteStore) => void)
      | undefined

    handler?.(event, createJsonWriteStore(sliceName, tx))
  } else {
    const handler = registration.apply?.[event.type] as
      | ((event: Event, tx: StoreTx) => void)
      | undefined

    handler?.(event, tx)
  }

  if (eventOrder !== undefined) {
    tx.delete(sliceCursors).where(eq(sliceCursors.sliceName, sliceName)).run()

    tx.insert(sliceCursors)
      .values({ sliceName, lastAppliedOrder: eventOrder })
      .run()
  }
}

function applyEagerSlices(events: Event[], tx: StoreTx) {
  for (const event of events) {
    for (const registration of sliceRegistrations) {
      if (!registration.eager) {
        continue
      }

      applyEventToSlice(
        registration,
        event,
        (event as Event & { order?: number }).order,
        tx,
      )
    }
  }
}

function persistEvents(events: Event[], tx: StoreTx): Event[] {
  return events.map((event) => {
    tx.insert(eventTable)
      .values({
        id: event.id,
        type: event.type,
        payload: JSON.stringify(event.payload),
        createdAt: new Date(),
      })
      .run()

    const persistedEvent = tx
      .select({ order: eventTable.order })
      .from(eventTable)
      .where(eq(eventTable.id, event.id))
      .get()

    if (!persistedEvent) {
      throw new Error(`Event was not persisted: ${event.id}`)
    }

    return {
      ...event,
      order: persistedEvent.order,
    }
  }) as Event[]
}

function isCommandRegistration(
  slice: SliceRegistration,
): slice is AnyCommandRegistration {
  return slice.kind === 'command'
}

function collectCommandRegistrations(
  registrations: readonly SliceRegistration[],
) {
  const commands: AnyCommandRegistration[] = []

  for (const registration of registrations) {
    if (isCommandRegistration(registration)) {
      commands.push(registration)
    }
  }

  return commands
}

function collectReactionRegistrations(
  registrations: readonly SliceRegistration[],
) {
  const reactions: AnyReactionRegistration[] = []

  for (const registration of registrations) {
    if (registration.kind === 'reaction') {
      reactions.push(registration)
    }
  }

  return reactions
}

function collectProjectionRegistrations(
  registrations: readonly SliceRegistration[],
) {
  const projections: AnyProjectionRegistration[] = []

  for (const registration of registrations) {
    if (registration.kind === 'projection') {
      projections.push(registration)
    }
  }

  return projections
}

type EventApplication = (event: Event, tx: StoreTx) => void

function collectEventApplications(registrations: readonly SliceRegistration[]) {
  const applications: Partial<Record<Event['type'], EventApplication[]>> = {}

  for (const registration of registrations) {
    if (!('apply' in registration) || !registration.apply) {
      continue
    }

    for (const eventType of Object.keys(
      registration.apply,
    ) as Event['type'][]) {
      const handler = registration.apply[eventType] as
        | ((event: Event, tx?: StoreTx) => void)
        | undefined

      if (!handler) {
        continue
      }

      const existingHandlers = applications[eventType] ?? []
      existingHandlers.push((event, tx) => {
        if (registration.json) {
          applyEventToSlice(
            registration,
            event,
            (event as Event & { order?: number }).order,
            tx,
          )
          return
        }

        handler(event, tx)
      })
      applications[eventType] = existingHandlers
    }
  }

  return applications
}

function createJsonReadStore(sliceName: string, tx: StoreTx): JsonReadStore {
  return {
    get: (key) => {
      const row = tx
        .select()
        .from(sliceJsonStates)
        .where(
          and(
            eq(sliceJsonStates.sliceName, sliceName),
            eq(sliceJsonStates.key, key),
          ),
        )
        .get()

      if (!row) {
        return undefined
      }

      return JSON.parse(row.value)
    },
  }
}

function createJsonWriteStore(sliceName: string, tx: StoreTx): JsonWriteStore {
  return {
    ...createJsonReadStore(sliceName, tx),
    set: (key, value) => {
      tx.delete(sliceJsonStates)
        .where(
          and(
            eq(sliceJsonStates.sliceName, sliceName),
            eq(sliceJsonStates.key, key),
          ),
        )
        .run()

      tx.insert(sliceJsonStates)
        .values({
          sliceName,
          key,
          value: JSON.stringify(value),
        })
        .run()
    },
    patch: (key, value) => {
      const existing = createJsonReadStore(sliceName, tx).get<
        Record<string, unknown>
      >(key)

      tx.delete(sliceJsonStates)
        .where(
          and(
            eq(sliceJsonStates.sliceName, sliceName),
            eq(sliceJsonStates.key, key),
          ),
        )
        .run()

      tx.insert(sliceJsonStates)
        .values({
          sliceName,
          key,
          value: JSON.stringify({ ...(existing ?? {}), ...value }),
        })
        .run()
    },
    delete: (key) => {
      tx.delete(sliceJsonStates)
        .where(
          and(
            eq(sliceJsonStates.sliceName, sliceName),
            eq(sliceJsonStates.key, key),
          ),
        )
        .run()
    },
  }
}

function sliceRegistrationName(registration: SliceRegistration) {
  if (registration.kind === 'command') {
    return registration.type
  }

  return registration.name
}

function assertUniqueRegistrations(
  registrations: readonly SliceRegistration[],
) {
  const commandTypes = new Set<string>()
  const projectionNames = new Set<string>()
  const reactionNames = new Set<string>()

  for (const registration of registrations) {
    if (registration.kind === 'command') {
      if (commandTypes.has(registration.type)) {
        throw new Error(`Duplicate command slice: ${registration.type}`)
      }

      commandTypes.add(registration.type)
      continue
    }

    if (registration.kind === 'reaction') {
      if (reactionNames.has(registration.name)) {
        throw new Error(`Duplicate reaction slice: ${registration.name}`)
      }

      reactionNames.add(registration.name)
      continue
    }

    if (projectionNames.has(registration.name)) {
      throw new Error(`Duplicate projection slice: ${registration.name}`)
    }

    projectionNames.add(registration.name)
  }
}
