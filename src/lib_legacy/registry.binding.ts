import type { StoreTx } from '.'
import type { Event } from '../features/events'
import type {
  AnyCommandRegistration,
  AnyProjectionRegistration,
  AnyReactionRegistration,
  CommandEnvelope,
  JsonWriteStore,
  SliceRegistration,
} from './registry.builders'
import type { RegistryRuntime } from './registry.runtime'
import { createSliceState, type BoundSliceState } from './registry.state'

export type BoundSliceRegistration = {
  name: string
  apply?: Partial<Record<Event['type'], (event: Event) => void>>
  state: BoundSliceState
}

export type BoundCommandRegistration = BoundSliceRegistration & {
  type: string
  decide: (payload: never) => Event[]
}

export type BoundProjectionRegistration = BoundSliceRegistration & {
  query: (input: never) => unknown
}

export type BoundReactionRegistration = BoundSliceRegistration & {
  react: () => CommandEnvelope[]
}

export function bindCommandRegistration(
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

export function bindProjectionRegistration(
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

export function bindReactionRegistration(
  registration: AnyReactionRegistration,
  runtime: RegistryRuntime,
): BoundReactionRegistration {
  const boundRegistration = bindSliceRegistration(registration, runtime)

  return {
    ...boundRegistration,
    react: () => registration.react(boundRegistration.state.input as never),
  }
}

export function bindSliceRegistration(
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

function sliceRegistrationName(registration: SliceRegistration) {
  if (registration.kind === 'command') {
    return registration.type
  }

  return registration.name
}
