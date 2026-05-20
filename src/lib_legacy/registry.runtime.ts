import type { z } from 'zod'

import type { StoreTx } from '.'
import type { Event } from '../features/events'
import type { JsonSliceStorage } from './json-storage'
import type {
  AnyProjectionRegistration,
  AnyReactionRegistration,
  SliceRegistration,
} from './registry.builders'
import {
  bindCommandRegistration,
  bindProjectionRegistration,
  bindReactionRegistration,
  bindSliceRegistration,
  type BoundSliceRegistration,
} from './registry.binding'
import { createRegistryCatalog } from './registry.catalog'
import { persistEvents, readEventsAfter } from './event-log'

const maxReactionCascadeRounds = 10

export type RegistryRuntime = {
  tx: StoreTx
  jsonStorage: JsonSliceStorage
}

export function createRegistry(
  sliceRegistrations: readonly SliceRegistration[],
) {
  const catalog = createRegistryCatalog(sliceRegistrations)
  type Command = z.infer<typeof catalog.commandInput>

  function decideCommand(command: Command, runtime: RegistryRuntime): Event[] {
    const registration = bindCommandRegistration(
      catalog.commandRegistrations.find(
        (candidate) => candidate.type === command.type,
      ),
      runtime,
    )

    if (!registration) {
      throw new Error(`Unknown command: ${command.type}`)
    }

    catchUpSliceState(registration, runtime)

    return registration.decide(command.payload as never)
  }

  function dispatchCommandInTx(
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
          for (const reaction of catalog.reactionsByEventType[event.type] ??
            []) {
            notifiedReactions.add(reaction)
          }
        }

        for (const reaction of notifiedReactions) {
          const reactionCommands = reactWithState(reaction, runtime)

          for (const reactionCommand of reactionCommands) {
            nextCommands.push(catalog.commandInput.parse(reactionCommand))
          }
        }
      }

      pendingCommands = nextCommands
    }

    return producedEvents
  }

  function applyEvents(events: Event[], runtime: RegistryRuntime) {
    for (const event of events) {
      for (const registration of sliceRegistrations) {
        if (!('apply' in registration) || !registration.apply?.[event.type]) {
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

  function queryProjection(
    registration: AnyProjectionRegistration,
    input: unknown,
    runtime: RegistryRuntime,
  ) {
    const boundRegistration = bindProjectionRegistration(registration, runtime)
    catchUpSliceState(boundRegistration, runtime)

    return boundRegistration.query(input as never)
  }

  function reactToEvent(
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

  return {
    sliceRegistrations,
    commandInput: catalog.commandInput,
    projectionRegistrations: catalog.projectionRegistrations,
    reactionRegistrations: catalog.reactionRegistrations,
    decideCommand,
    dispatchCommandInTx,
    applyEvents,
    queryProjection,
    reactToEvent,
  }
}

function catchUpSliceState(
  registration: BoundSliceRegistration,
  runtime: RegistryRuntime,
) {
  if (!registration.apply) {
    return
  }

  const persistedEvents = readEventsAfter(
    registration.state.lastAppliedOrder(),
    runtime.tx,
  )

  for (const event of persistedEvents) {
    applyEventToSlice(
      registration,
      event,
      (event as Event & { order?: number }).order,
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
