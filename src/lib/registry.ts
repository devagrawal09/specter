import { z } from 'zod'

import type { StoreTx } from '.'
import type { Event } from '../features/todos/events'
import { events as todoEvents } from '.'
export {
  createCommandSpec as createCommandSlice,
  createProjectionSpec as createProjectionSlice,
  createReactionSpec as createReactionSlice,
  createViewSpec,
} from './registry.builders'
export type {
  ApplyHandlers,
  CommandRegistration,
  CommandEnvelope,
  CommandSliceSchemaStep,
  ProjectionRegistration,
  ProjectionScenario,
  ProjectionSliceSchemaStep,
  ReactionRegistration,
  ReactionSliceApplyStep,
  ReactionSliceReactStep,
  SliceRegistration,
  ViewScenario,
} from './registry.builders'
import type {
  CommandRegistration,
  ProjectionRegistration,
  ReactionRegistration,
  SliceRegistration,
} from './registry.builders'
import { addTodo } from '../features/todos/add-todo/slice'
import { changeTodoCompletion } from '../features/todos/change-todo-completion/slice'
import { createTodoCheer } from '../features/todos/create-todo-cheer/slice'
import { removeTodo } from '../features/todos/remove-todo/slice'
import { todoCheers } from '../features/todos/todo-cheers/slice'
import { todoCompletionCheer } from '../features/todos/todo-completion-cheer-reaction/slice'
import { todosProjection } from '../features/todos/todos-view/slice'

const maxReactionCascadeRounds = 10

export const sliceRegistrations = [
  addTodo,
  changeTodoCompletion,
  removeTodo,
  createTodoCheer,
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
  throw new Error('Todo registry must include at least one command slice')
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
    throw new Error(`Unknown todo command: ${command.type}`)
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
        `Todo reaction cascade exceeded ${maxReactionCascadeRounds} rounds`,
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
      applyEvents(persistedEvents, tx)

      for (const event of persistedEvents) {
        for (const reaction of reactionRegistrations) {
          const reactionCommands = reaction.react(event, tx)

          for (const reactionCommand of reactionCommands) {
            nextCommands.push(commandInput.parse(reactionCommand))
          }
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

function persistEvents(events: Event[], tx: StoreTx): Event[] {
  return events.map((event) => {
    tx.insert(todoEvents)
      .values({
        id: event.id,
        type: event.type,
        payload: JSON.stringify(event.payload),
        createdAt: new Date(),
      })
      .run()

    return event
  })
}

function isCommandRegistration(
  slice: SliceRegistration,
): slice is CommandRegistration {
  return slice.kind === 'command'
}

function collectCommandRegistrations(
  registrations: readonly SliceRegistration[],
) {
  const commands: CommandRegistration[] = []

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
  const reactions: ReactionRegistration[] = []

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
  const projections: ProjectionRegistration[] = []

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
        | EventApplication
        | undefined

      if (!handler) {
        continue
      }

      const existingHandlers = applications[eventType] ?? []
      existingHandlers.push(handler)
      applications[eventType] = existingHandlers
    }
  }

  return applications
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
        throw new Error(`Duplicate todo command slice: ${registration.type}`)
      }

      commandTypes.add(registration.type)
      continue
    }

    if (registration.kind === 'reaction') {
      if (reactionNames.has(registration.name)) {
        throw new Error(`Duplicate todo reaction slice: ${registration.name}`)
      }

      reactionNames.add(registration.name)
      continue
    }

    if (projectionNames.has(registration.name)) {
      throw new Error(`Duplicate todo projection slice: ${registration.name}`)
    }

    projectionNames.add(registration.name)
  }
}
