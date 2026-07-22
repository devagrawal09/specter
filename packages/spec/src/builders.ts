import {
  SPECTER_SPECIFICATION_FORMAT_VERSION,
  SPECTER_SPECIFICATION_SCHEMA,
  type CommandScenario,
  type CommandSliceSpecification,
  type JsonValue,
  type NonEmptyScenarios,
  type QueryScenario,
  type QuerySliceSpecification,
  type ReactionScenario,
  type ReactionSliceSpecification,
  type ScenarioEvent,
} from './types.ts'

type DescriptionStep<TSpec> = {
  description(description: string): {
    scenarios<const TScenarios extends Parameters<TSpecFactory<TSpec>>>(
      ...scenarios: TScenarios
    ): ReturnType<TSpecFactory<TSpec>>
  }
}

type TSpecFactory<TSpec> =
  TSpec extends CommandSliceSpecification<infer TName>
    ? <const TScenarios extends NonEmptyScenarios<CommandScenario>>(
        ...scenarios: TScenarios
      ) => CommandSliceSpecification<TName, TScenarios>
    : TSpec extends QuerySliceSpecification<infer TName>
      ? <const TScenarios extends NonEmptyScenarios<QueryScenario>>(
          ...scenarios: TScenarios
        ) => QuerySliceSpecification<TName, TScenarios>
      : TSpec extends ReactionSliceSpecification<infer TName>
        ? <const TScenarios extends NonEmptyScenarios<ReactionScenario>>(
            ...scenarios: TScenarios
          ) => ReactionSliceSpecification<TName, TScenarios>
        : never

export function event<
  const TType extends string,
  const TPayload extends JsonValue,
>(eventType: TType, examplePayload: TPayload): ScenarioEvent<TType, TPayload> {
  return Object.freeze({ kind: 'scenario-event', eventType, examplePayload })
}

export function createCommandSlice<const TName extends string>(name: TName) {
  return createBuilder('command', name) as DescriptionStep<
    CommandSliceSpecification<TName>
  >
}

export function createQuerySlice<const TName extends string>(name: TName) {
  return createBuilder('query', name) as DescriptionStep<
    QuerySliceSpecification<TName>
  >
}

export function createReactionSlice<const TName extends string>(name: TName) {
  return createBuilder('reaction', name) as DescriptionStep<
    ReactionSliceSpecification<TName>
  >
}

function createBuilder(kind: SliceSpecificationKind, name: string) {
  return Object.freeze({
    description: (description: string) =>
      Object.freeze({
        scenarios: (...scenarios: SliceScenarioInput[]) =>
          Object.freeze({
            $schema: SPECTER_SPECIFICATION_SCHEMA,
            formatVersion: SPECTER_SPECIFICATION_FORMAT_VERSION,
            kind,
            name,
            description,
            scenarios: Object.freeze(scenarios.map(freezeScenario)),
          }),
      }),
  })
}

type SliceSpecificationKind = 'command' | 'query' | 'reaction'
type SliceScenarioInput = {
  readonly description: string
  readonly given: readonly ScenarioEvent[]
  readonly when?: JsonValue
  readonly expect: JsonValue | readonly JsonValue[]
  readonly reject?: { readonly reason: string }
}

function freezeScenario(scenario: SliceScenarioInput) {
  return Object.freeze({
    ...scenario,
    given: Object.freeze([...scenario.given]),
    ...(Array.isArray(scenario.expect)
      ? { expect: Object.freeze([...scenario.expect]) }
      : {}),
  })
}
