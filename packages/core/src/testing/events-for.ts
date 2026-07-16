import {
  isScenarioEvent,
  type ApplyEventDefinition,
  type SliceRegistration,
} from '../definition'

/**
 * Selects the exact Event Definition catalog needed by one focused Slice test.
 * The result includes Given/apply Events and accepted Command outcome Events.
 */
export function eventsFor(
  slice: SliceRegistration,
  fullCatalog: readonly ApplyEventDefinition[],
): readonly ApplyEventDefinition[] {
  const relevantTypes = new Set(
    slice.apply.map((registration) => registration.event.type),
  )

  for (const scenario of slice.scenarios) {
    for (const candidate of scenario.given) {
      if (isScenarioEvent(candidate)) relevantTypes.add(candidate.eventType)
    }
    if (slice.kind === 'command') {
      for (const candidate of scenario.expect) {
        if (isScenarioEvent(candidate)) relevantTypes.add(candidate.eventType)
      }
    }
  }

  const definitions = new Map<string, ApplyEventDefinition>()
  for (const definition of fullCatalog) {
    if (definitions.has(definition.type)) {
      throw new Error(
        `eventsFor(${slice.name}) found duplicate Event Definition "${definition.type}" in the full catalog. Remove the duplicate registration.`,
      )
    }
    definitions.set(definition.type, definition)
  }

  const missing = [...relevantTypes].filter((type) => !definitions.has(type))
  if (missing.length > 0) {
    throw new Error(
      `eventsFor(${slice.name}) could not resolve Event Definition${missing.length === 1 ? '' : 's'}: ${missing.map((type) => `"${type}"`).join(', ')}. Add the matching definition${missing.length === 1 ? '' : 's'} to the full app Event catalog; focused tests derive requirements from Given Events, apply handlers, and accepted Command outcomes.`,
    )
  }

  return fullCatalog.filter((definition) => relevantTypes.has(definition.type))
}
