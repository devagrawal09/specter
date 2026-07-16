import type { ApplyEventDefinition, SliceRegistration } from '@specter-ts/core'

export function eventsForSliceImplementations(
  implementations: readonly SliceRegistration[],
  definitions: readonly ApplyEventDefinition[],
) {
  const eventTypes = new Set<string>()

  for (const implementation of implementations) {
    for (const scenario of implementation.scenarios) {
      for (const given of scenario.given) eventTypes.add(given.eventType)

      if (implementation.kind === 'command') {
        for (const expected of scenario.expect) {
          if (
            typeof expected === 'object' &&
            expected !== null &&
            'kind' in expected &&
            expected.kind === 'scenario-event' &&
            'eventType' in expected &&
            typeof expected.eventType === 'string'
          ) {
            eventTypes.add(expected.eventType)
          }
        }
      }
    }
  }

  return definitions.filter((definition) => eventTypes.has(definition.type))
}
