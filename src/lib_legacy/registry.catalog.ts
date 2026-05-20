import { z } from 'zod'

import type { Event } from '../features/events'
import type {
  AnyCommandRegistration,
  AnyProjectionRegistration,
  AnyReactionRegistration,
  SliceRegistration,
} from './registry.builders'

export function createRegistryCatalog(
  registrations: readonly SliceRegistration[],
) {
  assertUniqueRegistrations(registrations)

  const commandRegistrations = collectCommandRegistrations(registrations)

  if (commandRegistrations.length === 0) {
    throw new Error('Registry must include at least one command slice')
  }

  return {
    commandRegistrations,
    projectionRegistrations: collectProjectionRegistrations(registrations),
    reactionRegistrations: collectReactionRegistrations(registrations),
    commandInput: createCommandInput(commandRegistrations),
    reactionsByEventType: collectReactionsByEventType(registrations),
  }
}

function createCommandInput(
  commandRegistrations: readonly AnyCommandRegistration[],
) {
  const commandSchemas = commandRegistrations.map((command) =>
    z.object({ type: z.literal(command.type), payload: command.schema }),
  )

  return z.discriminatedUnion('type', [
    commandSchemas[0],
    ...commandSchemas.slice(1),
  ])
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

function collectReactionsByEventType(
  registrations: readonly SliceRegistration[],
) {
  const reactionsByEventType: Partial<
    Record<Event['type'], AnyReactionRegistration[]>
  > = {}

  for (const registration of registrations) {
    if (registration.kind !== 'reaction' || !registration.apply) {
      continue
    }

    for (const eventType of Object.keys(
      registration.apply,
    ) as Event['type'][]) {
      if (!registration.apply[eventType]) {
        continue
      }

      reactionsByEventType[eventType] = [
        ...(reactionsByEventType[eventType] ?? []),
        registration,
      ]
    }
  }

  return reactionsByEventType
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
