const scenarioEventBrand: unique symbol = Symbol('ScenarioEvent')

export type ScenarioEvent<TType extends string = string, TPayload = unknown> = {
  readonly kind: 'scenario-event'
  readonly eventType: TType
  readonly examplePayload: TPayload
  readonly [scenarioEventBrand]: true
}

export function event<const TType extends string, const TPayload>(
  eventType: TType,
  examplePayload: TPayload,
): ScenarioEvent<TType, TPayload> {
  return Object.freeze({
    kind: 'scenario-event' as const,
    eventType,
    examplePayload,
    [scenarioEventBrand]: true as const,
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
    scenarioEventBrand in value &&
    value[scenarioEventBrand] === true
  )
}

export type AcceptedCommandScenario<TWhen = unknown> = {
  readonly description: string
  readonly given: readonly ScenarioEvent[]
  readonly when: TWhen
  readonly expect: readonly [ScenarioEvent, ...ScenarioEvent[]]
  readonly reject?: never
}

export type RejectedCommandScenario<TWhen = unknown> = {
  readonly description: string
  readonly given: readonly ScenarioEvent[]
  readonly when: TWhen
  readonly expect: readonly []
  readonly reject?: {
    readonly reason: string
  }
}

export type CommandScenario<TWhen = unknown> =
  | AcceptedCommandScenario<TWhen>
  | RejectedCommandScenario<TWhen>

export type QueryScenario<TWhen = unknown, TExpect = unknown> = {
  readonly description: string
  readonly given: readonly ScenarioEvent[]
  readonly when: TWhen
  readonly expect: TExpect
}

export type ReactionScenario<TPayload = unknown> = {
  readonly description: string
  readonly given: readonly ScenarioEvent[]
  readonly expect: readonly TPayload[]
}

export type SliceScenario =
  | CommandScenario
  | QueryScenario
  | ReactionScenario<unknown>

export type NonEmptyScenarios<TScenario extends SliceScenario> = readonly [
  TScenario,
  ...TScenario[],
]
