import { z } from 'zod'

import type { StoredTodoEvent, Event, StoreTx } from './shared'
export {
  createCommandSlice,
  createProjectionSlice,
} from './registry.builders'
export type {
  CommandRegistration,
  CommandSliceSchemaStep,
  ProjectionRegistration,
  ProjectionSliceSchemaStep,
  SliceRegistration,
} from './registry.builders'
import type {
  CommandRegistration,
  SliceRegistration,
} from './registry.builders'
import { addTodoSliceRegistration } from './slices/add-todo/slice'
import { changeTodoCompletionSliceRegistration } from './slices/change-todo-completion/slice'
import { removeTodoSliceRegistration } from './slices/remove-todo/slice'
import { todosViewSliceRegistration } from './slices/todos-view/slice'

export const sliceRegistrations = [
  addTodoSliceRegistration,
  changeTodoCompletionSliceRegistration,
  removeTodoSliceRegistration,
  todosViewSliceRegistration,
] as const satisfies readonly SliceRegistration[]

assertUniqueRegistrations(sliceRegistrations)

const commandRegistrations = collectCommandRegistrations(sliceRegistrations)

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

export function decideCommand(tx: StoreTx, command: Command): Event[] {
  const registration = commandRegistrations.find(
    (candidate) => candidate.type === command.type,
  )

  if (!registration) {
    throw new Error(`Unknown todo command: ${command.type}`)
  }

  return registration.decide(tx, command.payload as never)
}

export function applyEvents(tx: StoreTx, events: StoredTodoEvent[]) {
  for (const slice of sliceRegistrations) {
    if ('applyEvents' in slice && slice.applyEvents) {
      slice.applyEvents(tx, events)
    }
  }
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

function assertUniqueRegistrations(
  registrations: readonly SliceRegistration[],
) {
  const commandTypes = new Set<string>()
  const projectionNames = new Set<string>()

  for (const registration of registrations) {
    if (registration.kind === 'command') {
      if (commandTypes.has(registration.type)) {
        throw new Error(`Duplicate todo command slice: ${registration.type}`)
      }

      commandTypes.add(registration.type)
      continue
    }

    if (projectionNames.has(registration.name)) {
      throw new Error(`Duplicate todo projection slice: ${registration.name}`)
    }

    projectionNames.add(registration.name)
  }
}
