import {
  isScenarioEvent,
  type ApplyEventDefinition,
  type SliceRegistration,
} from '../definition'

export type EventScenarioReference = {
  readonly sliceName: string
  readonly sliceKind: SliceRegistration['kind']
  readonly scenarioIndex: number
  readonly scenarioDescription: string
  readonly location: 'given' | 'expect'
  readonly eventIndex: number
}

export type EventApplyReference = {
  readonly sliceName: string
  readonly sliceKind: SliceRegistration['kind']
  readonly applyIndex: number
}

export type EventPropagation = {
  readonly eventType: string
  readonly definition: ApplyEventDefinition
  readonly producedBy: readonly EventScenarioReference[]
  readonly consumedBy: readonly EventApplyReference[]
  readonly scenarioExamples: readonly EventScenarioReference[]
}

export type EventPropagationInput = {
  readonly events: readonly ApplyEventDefinition[]
  readonly slices: readonly SliceRegistration[]
}

/**
 * Maps an Event payload change to every Command outcome, Given example, and
 * apply handler that must be reviewed. This is intentionally static: it
 * reports the executable domain contract without importing application files.
 */
export function analyzeEventPropagation(
  input: EventPropagationInput,
  eventType?: string,
): readonly EventPropagation[] {
  const definitions = new Map<string, ApplyEventDefinition>()
  for (const definition of input.events) {
    if (definitions.has(definition.type)) {
      throw new Error(
        `Cannot analyze Event propagation because "${definition.type}" is registered more than once.`,
      )
    }
    definitions.set(definition.type, definition)
  }

  if (eventType && !definitions.has(eventType)) {
    throw new Error(
      `Cannot analyze unknown Event type "${eventType}". Register its EventDefinition first.`,
    )
  }

  const selected = eventType
    ? [definitions.get(eventType) as ApplyEventDefinition]
    : [...definitions.values()]

  return selected.map((definition) => {
    const producedBy: EventScenarioReference[] = []
    const scenarioExamples: EventScenarioReference[] = []
    const consumedBy: EventApplyReference[] = []

    for (const slice of input.slices) {
      for (const [applyIndex, apply] of slice.apply.entries()) {
        if (apply.event.type === definition.type) {
          consumedBy.push({
            sliceName: slice.name,
            sliceKind: slice.kind,
            applyIndex,
          })
        }
      }

      for (const [scenarioIndex, scenario] of slice.scenarios.entries()) {
        for (const [eventIndex, candidate] of scenario.given.entries()) {
          if (
            isScenarioEvent(candidate) &&
            candidate.eventType === definition.type
          ) {
            scenarioExamples.push({
              sliceName: slice.name,
              sliceKind: slice.kind,
              scenarioIndex,
              scenarioDescription: scenario.description,
              location: 'given',
              eventIndex,
            })
          }
        }

        if (slice.kind === 'command') {
          for (const [eventIndex, candidate] of scenario.expect.entries()) {
            if (
              !isScenarioEvent(candidate) ||
              candidate.eventType !== definition.type
            ) {
              continue
            }
            const reference: EventScenarioReference = {
              sliceName: slice.name,
              sliceKind: slice.kind,
              scenarioIndex,
              scenarioDescription: scenario.description,
              location: 'expect',
              eventIndex,
            }
            producedBy.push(reference)
            scenarioExamples.push(reference)
          }
        }
      }
    }

    return {
      eventType: definition.type,
      definition,
      producedBy,
      consumedBy,
      scenarioExamples,
    }
  })
}

export function formatEventPropagation(propagation: EventPropagation): string {
  const lines = [`Event "${propagation.eventType}" propagation:`]
  lines.push('  Command outcomes:')
  if (propagation.producedBy.length === 0) lines.push('    (none)')
  for (const reference of propagation.producedBy) {
    lines.push(
      `    - ${reference.sliceName}: scenario[${reference.scenarioIndex}] "${reference.scenarioDescription}" ${reference.location}[${reference.eventIndex}]`,
    )
  }
  lines.push('  Apply handlers:')
  if (propagation.consumedBy.length === 0) lines.push('    (none)')
  for (const reference of propagation.consumedBy) {
    lines.push(
      `    - ${reference.sliceKind} ${reference.sliceName}: apply[${reference.applyIndex}]`,
    )
  }
  lines.push('  Scenario examples to update:')
  if (propagation.scenarioExamples.length === 0) lines.push('    (none)')
  for (const reference of propagation.scenarioExamples) {
    lines.push(
      `    - ${reference.sliceName}: scenario[${reference.scenarioIndex}] "${reference.scenarioDescription}" ${reference.location}[${reference.eventIndex}]`,
    )
  }
  return lines.join('\n')
}
