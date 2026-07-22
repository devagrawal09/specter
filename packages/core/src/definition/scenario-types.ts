import type { ScenarioEvent } from '@specter-ts/spec'

export type {
  AcceptedCommandScenario,
  CommandScenario,
  NonEmptyScenarios,
  QueryScenario,
  ReactionScenario,
  RejectedCommandScenario,
  ScenarioEvent,
  SliceScenario,
} from '@specter-ts/spec'

export function event<const TType extends string, const TPayload>(
  eventType: TType,
  examplePayload: TPayload,
): ScenarioEvent<TType, TPayload & import('@specter-ts/spec').JsonValue> {
  return Object.freeze({
    kind: 'scenario-event' as const,
    eventType,
    examplePayload: examplePayload as TPayload &
      import('@specter-ts/spec').JsonValue,
  })
}

export function isScenarioEvent(value: unknown): value is ScenarioEvent {
  return (
    value !== null &&
    typeof value === 'object' &&
    'kind' in value &&
    value.kind === 'scenario-event' &&
    'eventType' in value &&
    typeof value.eventType === 'string' &&
    'examplePayload' in value
  )
}
