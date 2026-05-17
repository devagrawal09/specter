import { z } from 'zod'

import type { StoredEvent, Event, StoreTx } from './shared'
import { events as todoEvents } from './shared'
export {
  createCommandSlice,
  createProjectionSlice,
  createReactionSlice,
} from './registry.builders'
export type {
  CommandRegistration,
  CommandEnvelope,
  CommandSliceSchemaStep,
  ProjectionRegistration,
  ProjectionSliceSchemaStep,
  ReactionRegistration,
  ReactionSliceApplyStep,
  ReactionSliceReactStep,
  SliceRegistration,
} from './registry.builders'
import type {
  CommandRegistration,
  ReactionRegistration,
  SliceRegistration,
} from './registry.builders'
import { addTodoSliceRegistration } from './slices/add-todo/slice'
import { changeTodoCompletionSliceRegistration } from './slices/change-todo-completion/slice'
import { createTodoCheerSliceRegistration } from './slices/create-todo-cheer/slice'
import { removeTodoSliceRegistration } from './slices/remove-todo/slice'
import { todoCheersSliceRegistration } from './slices/todo-cheers/slice'
import { todoCompletionCheerReactionSliceRegistration } from './slices/todo-completion-cheer-reaction/slice'
import { todosViewSliceRegistration } from './slices/todos-view/slice'

const maxReactionCascadeRounds = 10

export const sliceRegistrations = [
  addTodoSliceRegistration,
  changeTodoCompletionSliceRegistration,
  removeTodoSliceRegistration,
  createTodoCheerSliceRegistration,
  todoCompletionCheerReactionSliceRegistration,
  todosViewSliceRegistration,
  todoCheersSliceRegistration,
] as const satisfies readonly SliceRegistration[]

assertUniqueRegistrations(sliceRegistrations)

const commandRegistrations = collectCommandRegistrations(sliceRegistrations)
const reactionRegistrations = collectReactionRegistrations(sliceRegistrations)

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

      const storedEvents = persistEvents(events, tx)
      applyEvents(storedEvents, tx)

      for (const event of storedEvents) {
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

export function applyEvents(events: StoredEvent[], tx: StoreTx) {
  for (const event of events) {
    for (const slice of sliceRegistrations) {
      if ('apply' in slice && slice.apply) {
        slice.apply(event, tx)
      }
    }
  }
}

function persistEvents(events: Event[], tx: StoreTx): StoredEvent[] {
  return events.map((event) => {
    const row = tx
      .insert(todoEvents)
      .values({
        type: event.type,
        payload: JSON.stringify(event.payload),
        createdAt: new Date(),
      })
      .returning({
        id: todoEvents.id,
        type: todoEvents.type,
        payload: todoEvents.payload,
      })
      .get()

    if (!row) {
      throw new Error('Failed to persist todo event')
    }

    const payload: unknown = JSON.parse(row.payload)

    return {
      id: row.id,
      type: row.type,
      payload,
    } as StoredEvent
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
