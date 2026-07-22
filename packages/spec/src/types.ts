export const SPECTER_SPECIFICATION_SCHEMA =
  'https://specter.dev/specification/v1/slice.schema.json' as const
export const SPECTER_SPECIFICATION_FORMAT_VERSION = 1 as const

export type JsonPrimitive = string | number | boolean | null
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

export type ScenarioEvent<
  TType extends string = string,
  TPayload = JsonValue,
> = {
  readonly kind: 'scenario-event'
  readonly eventType: TType
  readonly examplePayload: TPayload
}

export type AcceptedCommandScenario<TWhen extends JsonValue = JsonValue> = {
  readonly description: string
  readonly given: readonly ScenarioEvent[]
  readonly when: TWhen
  readonly expect: readonly [ScenarioEvent, ...ScenarioEvent[]]
  readonly reject?: never
}

export type RejectedCommandScenario<TWhen extends JsonValue = JsonValue> = {
  readonly description: string
  readonly given: readonly ScenarioEvent[]
  readonly when: TWhen
  readonly expect: readonly []
  readonly reject: { readonly reason: string }
}

export type CommandScenario<TWhen extends JsonValue = JsonValue> =
  | AcceptedCommandScenario<TWhen>
  | RejectedCommandScenario<TWhen>

export type QueryScenario<
  TWhen extends JsonValue = JsonValue,
  TExpect extends JsonValue = JsonValue,
> = {
  readonly description: string
  readonly given: readonly ScenarioEvent[]
  readonly when: TWhen
  readonly expect: TExpect
}

export type ReactionScenario<TPayload extends JsonValue = JsonValue> = {
  readonly description: string
  readonly given: readonly ScenarioEvent[]
  readonly expect: readonly TPayload[]
}

export type SliceScenario = CommandScenario | QueryScenario | ReactionScenario
export type NonEmptyScenarios<TScenario extends SliceScenario> = readonly [
  TScenario,
  ...TScenario[],
]

type SpecificationBase<
  TKind extends 'command' | 'query' | 'reaction',
  TName extends string,
  TScenarios extends NonEmptyScenarios<SliceScenario>,
> = {
  readonly $schema: typeof SPECTER_SPECIFICATION_SCHEMA
  readonly formatVersion: typeof SPECTER_SPECIFICATION_FORMAT_VERSION
  readonly kind: TKind
  readonly name: TName
  readonly description: string
  readonly scenarios: TScenarios
}

export type CommandSliceSpecification<
  TName extends string = string,
  TScenarios extends
    NonEmptyScenarios<CommandScenario> = NonEmptyScenarios<CommandScenario>,
> = SpecificationBase<'command', TName, TScenarios>

export type QuerySliceSpecification<
  TName extends string = string,
  TScenarios extends
    NonEmptyScenarios<QueryScenario> = NonEmptyScenarios<QueryScenario>,
> = SpecificationBase<'query', TName, TScenarios>

export type ReactionSliceSpecification<
  TName extends string = string,
  TScenarios extends
    NonEmptyScenarios<ReactionScenario> = NonEmptyScenarios<ReactionScenario>,
> = SpecificationBase<'reaction', TName, TScenarios>

export type SliceSpecification =
  | CommandSliceSpecification
  | QuerySliceSpecification
  | ReactionSliceSpecification

export type SpecificationDigest = `sha256:${string}`
