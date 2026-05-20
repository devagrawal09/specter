import { asc, eq, gt } from 'drizzle-orm'
import { z } from 'zod'

import type { StoreTx } from '.'
import type { Event } from '../features/events'
import { events as eventTable, sliceCursors } from '.'
export {
  createCommandSpec as createCommandSlice,
  createProjectionSpec as createProjectionSlice,
  createReactionSpec as createReactionSlice,
  createViewSpec,
} from './registry.builders'
import type { JsonSliceSnapshot, JsonSliceStorage } from './json-storage'
import { emptySnapshot } from './json-storage'
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
  CommandEnvelope,
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

export type RegistryRuntime = {
  tx: StoreTx
  jsonStorage: JsonSliceStorage
}

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

export function decideCommand(
  command: Command,
  runtime: RegistryRuntime,
): Event[] {
  const registration = bindCommandRegistration(
    commandRegistrations.find((candidate) => candidate.type === command.type),
    runtime,
  )

  if (!registration) {
    throw new Error(`Unknown command: ${command.type}`)
  }

  catchUpSliceState(registration, runtime)

  return registration.decide(command.payload as never)
}

export function dispatchCommandInTx(
  command: Command,
  runtime: RegistryRuntime,
): Event[] {
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
      const events = decideCommand(pendingCommand, runtime)
      producedEvents.push(...events)

      if (events.length === 0) {
        continue
      }

      const persistedEvents = persistEvents(events, runtime.tx)
      applyEagerSlices(persistedEvents, runtime)

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
        const reactionCommands = reactWithState(reaction, runtime)

        for (const reactionCommand of reactionCommands) {
          nextCommands.push(commandInput.parse(reactionCommand))
        }
      }
    }

    pendingCommands = nextCommands
  }

  return producedEvents
}

export function applyEvents(events: Event[], runtime: RegistryRuntime) {
  for (const event of events) {
    const handlers = eventApplications[event.type]

    if (!handlers) {
      continue
    }

    for (const handler of handlers) {
      handler(event, runtime)
    }
  }
}

export function queryProjection(
  registration: AnyProjectionRegistration,
  input: unknown,
  runtime: RegistryRuntime,
) {
  const boundRegistration = bindProjectionRegistration(registration, runtime)
  catchUpSliceState(boundRegistration, runtime)

  return boundRegistration.query(input as never)
}

export function reactToEvent(
  registration: AnyReactionRegistration,
  _event: Event,
  runtime: RegistryRuntime,
) {
  const boundRegistration = bindReactionRegistration(registration, runtime)
  catchUpSliceState(boundRegistration, runtime)

  return boundRegistration.react()
}

function reactWithState(
  registration: AnyReactionRegistration,
  runtime: RegistryRuntime,
) {
  const boundRegistration = bindReactionRegistration(registration, runtime)
  catchUpSliceState(boundRegistration, runtime)

  return boundRegistration.react()
}

function catchUpSliceState(
  registration: BoundSliceRegistration,
  runtime: RegistryRuntime,
) {
  if (!registration.apply) {
    return
  }

  const lastAppliedOrder = registration.state.lastAppliedOrder()

  const persistedEvents = runtime.tx
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
    )
  }

  registration.state.commit()
}

function applyEventToSlice(
  registration: BoundSliceRegistration,
  event: Event,
  eventOrder: number | undefined,
) {
  if (!registration.apply) {
    return
  }

  registration.apply[event.type]?.(event)

  if (eventOrder !== undefined) {
    registration.state.setLastAppliedOrder(eventOrder)
  }
}

function applyEagerSlices(events: Event[], runtime: RegistryRuntime) {
  for (const event of events) {
    for (const registration of sliceRegistrations) {
      if (!registration.eager) {
        continue
      }

      const boundRegistration = bindSliceRegistration(registration, runtime)
      applyEventToSlice(
        boundRegistration,
        event,
        (event as Event & { order?: number }).order,
      )
      boundRegistration.state.commit()
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

type EventApplication = (event: Event, runtime: RegistryRuntime) => void

function collectEventApplications(registrations: readonly SliceRegistration[]) {
  const applications: Partial<Record<Event['type'], EventApplication[]>> = {}

  for (const registration of registrations) {
    if (!('apply' in registration) || !registration.apply) {
      continue
    }

    for (const eventType of Object.keys(
      registration.apply,
    ) as Event['type'][]) {
      if (!registration.apply[eventType]) {
        continue
      }

      const existingHandlers = applications[eventType] ?? []
      existingHandlers.push((event, runtime) => {
        const boundRegistration = bindSliceRegistration(registration, runtime)
        applyEventToSlice(
          boundRegistration,
          event,
          (event as Event & { order?: number }).order,
        )
        boundRegistration.state.commit()
      })
      applications[eventType] = existingHandlers
    }
  }

  return applications
}

type BoundSliceState = {
  input: StoreTx | JsonWriteStore
  lastAppliedOrder: () => number
  setLastAppliedOrder: (order: number) => void
  commit: () => void
}

type BoundSliceRegistration = {
  name: string
  apply?: Partial<Record<Event['type'], (event: Event) => void>>
  state: BoundSliceState
}

type BoundCommandRegistration = BoundSliceRegistration & {
  type: string
  decide: (payload: never) => Event[]
}

type BoundProjectionRegistration = BoundSliceRegistration & {
  query: (input: never) => unknown
}

type BoundReactionRegistration = BoundSliceRegistration & {
  react: () => CommandEnvelope[]
}

function bindCommandRegistration(
  registration: AnyCommandRegistration | undefined,
  runtime: RegistryRuntime,
): BoundCommandRegistration | undefined {
  if (!registration) {
    return undefined
  }

  const boundRegistration = bindSliceRegistration(registration, runtime)

  return {
    ...boundRegistration,
    type: registration.type,
    decide: (payload) =>
      registration.decide(payload, boundRegistration.state.input as never),
  }
}

function bindProjectionRegistration(
  registration: AnyProjectionRegistration,
  runtime: RegistryRuntime,
): BoundProjectionRegistration {
  const boundRegistration = bindSliceRegistration(registration, runtime)

  return {
    ...boundRegistration,
    query: (input) =>
      registration.query(boundRegistration.state.input as never, input),
  }
}

function bindReactionRegistration(
  registration: AnyReactionRegistration,
  runtime: RegistryRuntime,
): BoundReactionRegistration {
  const boundRegistration = bindSliceRegistration(registration, runtime)

  return {
    ...boundRegistration,
    react: () => registration.react(boundRegistration.state.input as never),
  }
}

function bindSliceRegistration(
  registration: SliceRegistration,
  runtime: RegistryRuntime,
): BoundSliceRegistration {
  const name = sliceRegistrationName(registration)
  const state = createSliceState(name, registration, runtime)

  return {
    name,
    state,
    apply: bindApplyHandlers(registration, state.input),
  }
}

function bindApplyHandlers(
  registration: SliceRegistration,
  input: StoreTx | JsonWriteStore,
) {
  if (!('apply' in registration) || !registration.apply) {
    return undefined
  }

  const handlers: Partial<Record<Event['type'], (event: Event) => void>> = {}

  for (const eventType of Object.keys(registration.apply) as Event['type'][]) {
    const handler = registration.apply[eventType] as
      | ((event: Event, input: never) => void)
      | undefined

    if (!handler) {
      continue
    }

    handlers[eventType] = (event) => handler(event, input as never)
  }

  return handlers
}

function createSliceState(
  sliceName: string,
  registration: SliceRegistration,
  runtime: RegistryRuntime,
): BoundSliceState {
  if (registration.json) {
    return createJsonSliceState(sliceName, runtime.jsonStorage)
  }

  return createSqlSliceState(sliceName, runtime.tx)
}

function createSqlSliceState(sliceName: string, tx: StoreTx): BoundSliceState {
  return {
    input: tx,
    lastAppliedOrder: () =>
      tx
        .select()
        .from(sliceCursors)
        .where(eq(sliceCursors.sliceName, sliceName))
        .get()?.lastAppliedOrder ?? 0,
    setLastAppliedOrder: (order) => {
      tx.delete(sliceCursors).where(eq(sliceCursors.sliceName, sliceName)).run()

      tx.insert(sliceCursors)
        .values({ sliceName, lastAppliedOrder: order })
        .run()
    },
    commit: () => {},
  }
}

function createJsonSliceState(
  sliceName: string,
  storage: JsonSliceStorage,
): BoundSliceState {
  const snapshot = storage.read(sliceName) ?? emptySnapshot()
  let dirty = false
  const store = createJsonWriteStore(snapshot, () => {
    dirty = true
  })

  return {
    input: store,
    lastAppliedOrder: () => snapshot.lastAppliedOrder,
    setLastAppliedOrder: (order) => {
      snapshot.lastAppliedOrder = order
      dirty = true
    },
    commit: () => {
      if (!dirty) {
        return
      }

      storage.write(sliceName, snapshot)
      dirty = false
    },
  }
}

function createJsonReadStore(snapshot: JsonSliceSnapshot): JsonReadStore {
  return {
    get: <TValue>(key: string) => {
      return snapshot.state[key] as TValue | undefined
    },
  }
}

function createJsonWriteStore(
  snapshot: JsonSliceSnapshot,
  markDirty: () => void,
): JsonWriteStore {
  return {
    ...createJsonReadStore(snapshot),
    set: (key, value) => {
      snapshot.state[key] = value
      markDirty()
    },
    patch: (key, value) => {
      const existing = snapshot.state[key] as
        | Record<string, unknown>
        | undefined
      snapshot.state[key] = { ...(existing ?? {}), ...value }
      markDirty()
    },
    delete: (key) => {
      delete snapshot.state[key]
      markDirty()
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
