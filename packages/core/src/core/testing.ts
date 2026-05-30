import type { StandardSchemaV1 } from '@standard-schema/spec'

import type { EventDraft, PersistedEvent } from './event'
import { decodeSchema } from './schema'
import type {
  CommandEnvelope,
  CommandSlice,
  QuerySlice,
  ReactionSlice,
  SliceRegistration,
} from './slice'

type CommandPayload<TSlice> =
  TSlice extends CommandSlice<string, infer TSchema>
    ? StandardSchemaV1.InferOutput<TSchema>
    : unknown

type QueryPayload<TSlice> =
  TSlice extends QuerySlice<string, infer TSchema>
    ? StandardSchemaV1.InferOutput<TSchema>
    : unknown

export type CommandScenario<TPayload = unknown> = {
  description: string
  given: readonly unknown[]
  when: TPayload
  expect: readonly unknown[]
  reject?: {
    reason: string
  }
}

export type QueryScenario<TWhen = unknown, TExpect = unknown> = {
  description: string
  given: readonly unknown[]
  when: TWhen
  expect: TExpect
}

export type ReactionScenario<TPayload = CommandEnvelope> = {
  description: string
  given: readonly unknown[]
  expect: readonly TPayload[]
}

export async function decideCommand<TSlice extends CommandSlice>(
  slice: TSlice,
  scenario: CommandScenario<CommandPayload<TSlice>>,
) {
  await replay([slice], autoOrder(scenario.given as readonly EventDraft[]))

  const state = slice.store.get(slice.name)

  return slice.handle(scenario.when, state.read)
}

export async function querySlice<TSlice extends QuerySlice>(
  slice: TSlice,
  scenario: QueryScenario<QueryPayload<TSlice>>,
) {
  await replay([slice], autoOrder(scenario.given as readonly EventDraft[]))

  const state = slice.store.get(slice.name)

  return slice.handle(
    await decodeSchema(slice.schema, scenario.when),
    state.read,
  )
}

export async function reactToScenario<TPayload>(
  slice: ReactionSlice<string, TPayload>,
  scenario: ReactionScenario<TPayload>,
) {
  await replay([slice], autoOrder(scenario.given as readonly EventDraft[]))

  const payloads: TPayload[] = []
  const state = slice.store.get(slice.name)
  const payload = await slice.handle(state.read)

  if (payload !== undefined) {
    payloads.push(payload)
  }

  return payloads
}

export async function replay(
  registrations: readonly SliceRegistration[],
  events: readonly PersistedEvent[],
) {
  for (const event of events) {
    for (const registration of registrations.filter(
      (item) => item.apply?.[event.type],
    )) {
      const state = registration.store.get(registration.name)
      const handler = registration.apply?.[event.type]

      if (handler) {
        await handler(event, state.write)
      }

      await state.setLastAppliedOrder(event.order)
    }
  }
}

export function autoOrder(events: readonly EventDraft[]) {
  return events.map((event, index) => ({
    ...event,
    id: `scenario-event-${index + 1}`,
    order: index + 1,
    recordedAt: new Date(0),
  })) satisfies PersistedEvent[]
}
