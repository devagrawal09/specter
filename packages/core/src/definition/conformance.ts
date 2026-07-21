import type { StandardSchemaV1 } from '@standard-schema/spec'
import { Effect } from 'effect'

import { isScenarioEvent, type ScenarioEvent } from './scenario-types'
import { validateSchema, valuesEqual } from './schemas'
import type {
  ApplyEventDefinition,
  CommandSlice,
  SliceRegistration,
} from './slices'

export type ConformanceDiagnostic = {
  readonly code: string
  readonly message: string
  readonly remediation?: string
  readonly sliceName?: string
  readonly scenarioDescription?: string
  readonly location?: string
  readonly eventType?: string
  readonly path?: string
}

export class SpecterConformanceError extends AggregateError {
  readonly _tag = 'SpecterConformanceError' as const
  readonly code = 'SPECTER_CONFORMANCE_FAILED' as const
  readonly diagnostics: readonly ConformanceDiagnostic[]

  constructor(diagnostics: readonly ConformanceDiagnostic[]) {
    const details = diagnostics.map(formatConformanceDiagnostic)

    super(
      details.map((detail) => new Error(detail)),
      [
        `Specter conformance failed with ${diagnostics.length} issue${
          diagnostics.length === 1 ? '' : 's'
        }:`,
        ...details.map((detail, index) => `${index + 1}. ${detail}`),
      ].join('\n'),
    )
    this.name = 'SpecterConformanceError'
    this.diagnostics = diagnostics
  }
}

export type ConformanceInput = {
  readonly events: readonly ApplyEventDefinition[]
  readonly slices: readonly SliceRegistration[]
}

export type ConformanceOptions = {
  readonly requireEveryEventInAScenario?: boolean
  readonly requireCommandSlice?: boolean
}

export function assertConforms(
  input: ConformanceInput,
  options: ConformanceOptions = {},
): Effect.Effect<void, SpecterConformanceError> {
  return collectConformanceDiagnostics(input, options).pipe(
    Effect.flatMap((diagnostics) =>
      diagnostics.length > 0
        ? Effect.fail(new SpecterConformanceError(diagnostics))
        : Effect.void,
    ),
  )
}

export function collectConformanceDiagnostics(
  input: ConformanceInput,
  options: ConformanceOptions = {},
): Effect.Effect<readonly ConformanceDiagnostic[]> {
  return Effect.gen(function* () {
  const diagnostics: ConformanceDiagnostic[] = []
  const eventDefinitions = new Map<string, ApplyEventDefinition>()
  const coveredEventTypes = new Set<string>()
  const sliceNames = new Set<string>()

  for (const definition of input.events) {
    const existing = eventDefinitions.get(definition.type)
    if (existing) {
      diagnostics.push({
        code: 'duplicate-event-type',
        eventType: definition.type,
        message: `Event type is registered more than once. Register exactly one EventDefinition for "${definition.type}".`,
      })
      continue
    }

    eventDefinitions.set(definition.type, definition)

    if (!isKebabCase(definition.type)) {
      diagnostics.push({
        code: 'event-type-format',
        eventType: definition.type,
        message: 'Event types must use kebab-case (for example, "todo-added").',
      })
    }
  }

  if (
    options.requireCommandSlice !== false &&
    !input.slices.some((slice) => slice.kind === 'command')
  ) {
    diagnostics.push({
      code: 'missing-command-slice',
      message: 'At least one completed Command Slice must be registered.',
    })
  }

  for (const slice of input.slices) {
    if (sliceNames.has(slice.name)) {
      diagnostics.push({
        code: 'duplicate-slice-name',
        sliceName: slice.name,
        message:
          'More than one implementation is registered for this Slice. Select exactly one implementation per Slice name.',
      })
    } else {
      sliceNames.add(slice.name)
    }

    if (slice.stage !== 'implementation') {
      diagnostics.push({
        code: 'incomplete-slice',
        sliceName: slice.name,
        message:
          'Only a completed Slice implementation can be registered; a specification is not executable.',
      })
      continue
    }

    if (!slice.name.trim()) {
      diagnostics.push({
        code: 'empty-slice-name',
        message: 'Slice names must not be empty.',
      })
    } else if (!isLowerCamelCase(slice.name)) {
      diagnostics.push({
        code: 'slice-name-format',
        sliceName: slice.name,
        message:
          'Slice names must use lower camel case (for example, "addTodo" or "workspaceFilesystemTree").',
      })
    }

    if (!slice.description.trim()) {
      diagnostics.push({
        code: 'empty-slice-description',
        sliceName: slice.name,
        message: 'Slice descriptions must not be empty.',
      })
    }

    if (!Array.isArray(slice.scenarios) || slice.scenarios.length === 0) {
      diagnostics.push({
        code: 'missing-scenarios',
        sliceName: slice.name,
        message: 'Every Slice must define at least one scenario.',
      })
      continue
    }

    const scenarioDescriptions = new Set<string>()
    const givenEventTypes = new Set<string>()

    for (const scenario of slice.scenarios) {
      if (!scenario.description.trim()) {
        diagnostics.push({
          code: 'empty-scenario-description',
          sliceName: slice.name,
          message: 'Scenario descriptions must not be empty.',
        })
      } else if (scenarioDescriptions.has(scenario.description)) {
        diagnostics.push({
          code: 'duplicate-scenario-description',
          sliceName: slice.name,
          scenarioDescription: scenario.description,
          message: 'Scenario descriptions must be unique within a Slice.',
        })
      } else {
        scenarioDescriptions.add(scenario.description)
      }

      for (const [index, candidate] of scenario.given.entries()) {
        if (!isScenarioEvent(candidate)) {
          diagnostics.push({
            code: 'invalid-scenario-event',
            sliceName: slice.name,
            scenarioDescription: scenario.description,
            location: `given[${index}]`,
            message:
              'Scenario Events must be created with event(type, payload). Runtime EventDraft values are not valid specification data.',
          })
          continue
        }

        givenEventTypes.add(candidate.eventType)
        coveredEventTypes.add(candidate.eventType)
        yield* validateScenarioEvent(candidate, eventDefinitions, diagnostics, {
          sliceName: slice.name,
          scenarioDescription: scenario.description,
          location: `given[${index}]`,
        })
      }

      switch (slice.kind) {
        case 'command': {
          if (slice.inputSchema) {
            yield* validateExample(
              slice.inputSchema,
              scenario.when,
              diagnostics,
              {
                code: 'command-input-schema',
                sliceName: slice.name,
                scenarioDescription: scenario.description,
                location: 'when',
              },
            )
          }

          for (const [index, candidate] of scenario.expect.entries()) {
            if (!isScenarioEvent(candidate)) {
              diagnostics.push({
                code: 'invalid-scenario-event',
                sliceName: slice.name,
                scenarioDescription: scenario.description,
                location: `expect[${index}]`,
                message:
                  'Accepted Command outcomes must be Scenario Events created with event(type, payload).',
              })
              continue
            }

            coveredEventTypes.add(candidate.eventType)
            yield* validateScenarioEvent(
              candidate,
              eventDefinitions,
              diagnostics,
              {
                sliceName: slice.name,
                scenarioDescription: scenario.description,
                location: `expect[${index}]`,
              },
            )
          }
          break
        }
        case 'query': {
          if (slice.inputSchema) {
            yield* validateExample(
              slice.inputSchema,
              scenario.when,
              diagnostics,
              {
                code: 'query-input-schema',
                sliceName: slice.name,
                scenarioDescription: scenario.description,
                location: 'when',
              },
            )
          }

          // `expect` is already the public, post-schema value. Standard Schema
          // exposes the raw-input -> public-output direction only, so applying
          // it to the expected public value would transform it twice.
          break
        }
        case 'reaction': {
          // Reaction expectations have the same post-schema semantics as
          // Query expectations; executable scenarios validate the actual
          // handler output once and compare it directly with this value.
          break
        }
      }
    }

    const applyEventTypes = new Set<string>()
    for (const [index, registration] of slice.apply.entries()) {
      const eventType = registration.event.type

      if (applyEventTypes.has(eventType)) {
        diagnostics.push({
          code: 'duplicate-apply-handler',
          sliceName: slice.name,
          location: `apply[${index}]`,
          eventType,
          message: `The Slice defines more than one apply handler for "${eventType}".`,
        })
      } else {
        applyEventTypes.add(eventType)
      }

      const registeredDefinition = eventDefinitions.get(eventType)
      if (!registeredDefinition) {
        diagnostics.push({
          code: 'unknown-apply-event',
          sliceName: slice.name,
          location: `apply[${index}]`,
          eventType,
          message: `The apply handler uses Event type "${eventType}", but the app does not register a matching EventDefinition.`,
        })
      } else if (registeredDefinition !== registration.event) {
        diagnostics.push({
          code: 'apply-event-definition-identity',
          sliceName: slice.name,
          location: `apply[${index}]`,
          eventType,
          message:
            'The apply handler must use the exact EventDefinition instance registered by the app.',
        })
      }
    }

    for (const eventType of givenEventTypes) {
      if (!applyEventTypes.has(eventType)) {
        diagnostics.push({
          code: 'missing-apply-handler',
          sliceName: slice.name,
          eventType,
          message: `Scenarios use "${eventType}" in Given data, but the implementation has no matching apply handler.`,
          remediation: `Add .apply(${eventType}, handler) to Slice "${slice.name}", or remove the Event from that Slice's Given scenarios.`,
        })
      }
    }

    for (const eventType of applyEventTypes) {
      if (!givenEventTypes.has(eventType)) {
        diagnostics.push({
          code: 'extra-apply-handler',
          sliceName: slice.name,
          eventType,
          message: `The implementation applies "${eventType}", but that Event never appears in the Slice's Given scenarios.`,
          remediation: `Add a Given example for "${eventType}" to Slice "${slice.name}", or remove the unused apply handler.`,
        })
      }
    }
  }

  if (options.requireEveryEventInAScenario !== false) {
    for (const eventType of eventDefinitions.keys()) {
      if (!coveredEventTypes.has(eventType)) {
        diagnostics.push({
          code: 'event-without-scenario',
          eventType,
          message: `Registered Event "${eventType}" must appear in at least one scenario Given or Command outcome.`,
          remediation:
            'For a whole-app check, add the missing scenario coverage. For a focused single-Slice test, pass eventsFor(slice, fullEventCatalog) from @specter-ts/core/testing instead of the whole app catalog.',
        })
      }
    }
  }

    return diagnostics
  })
}

export function commandScenarioEventTypes(
  slice: CommandSlice,
): ReadonlySet<string> {
  const eventTypes = new Set<string>()

  for (const scenario of slice.scenarios) {
    for (const candidate of scenario.expect) {
      if (isScenarioEvent(candidate)) eventTypes.add(candidate.eventType)
    }
  }

  return eventTypes
}

function validateScenarioEvent(
  scenarioEvent: ScenarioEvent,
  eventDefinitions: ReadonlyMap<string, ApplyEventDefinition>,
  diagnostics: ConformanceDiagnostic[],
  context: Pick<
    ConformanceDiagnostic,
    'sliceName' | 'scenarioDescription' | 'location'
  >,
) {
  return Effect.gen(function* () {
  const definition = eventDefinitions.get(scenarioEvent.eventType)
  if (!definition) {
    diagnostics.push({
      code: 'unknown-scenario-event',
      ...context,
      eventType: scenarioEvent.eventType,
      message: `Scenario Event "${scenarioEvent.eventType}" has no registered EventDefinition.`,
      remediation: `Add the "${scenarioEvent.eventType}" EventDefinition to this test/app Event catalog. Focused tests can derive the catalog with eventsFor(slice, fullEventCatalog).`,
    })
    return
  }

  const result = yield* Effect.promise(() =>
    validateSchema(definition.schema, scenarioEvent.examplePayload),
  )
  if (!result.success) {
    for (const issue of result.issues) {
      diagnostics.push({
        code: 'event-payload-schema',
        ...context,
        eventType: scenarioEvent.eventType,
        path: issuePath(issue.path),
        message: issue.message,
      })
    }
    return
  }

  if (!valuesEqual(result.value, scenarioEvent.examplePayload)) {
    diagnostics.push({
      code: 'event-payload-transformation',
      ...context,
      eventType: scenarioEvent.eventType,
      message:
        'The Event schema accepted this payload but changed, stripped, or generated data. Event payload schemas must preserve scenario payloads one-to-one.',
      remediation:
        'Make the Event schema validation-only, then use analyzeEventPropagation(...) from @specter-ts/core/testing to update every producer, Given example, and apply consumer.',
    })
  }
  })
}

function validateExample(
  schema: StandardSchemaV1,
  value: unknown,
  diagnostics: ConformanceDiagnostic[],
  context: Omit<ConformanceDiagnostic, 'message' | 'path'>,
) {
  return Effect.gen(function* () {
  const result = yield* Effect.promise(() => validateSchema(schema, value))
  if (result.success) return

  for (const issue of result.issues) {
    diagnostics.push({
      ...context,
      path: issuePath(issue.path),
      message: issue.message,
    })
  }
  })
}

function formatConformanceDiagnostic(diagnostic: ConformanceDiagnostic) {
  const context = [
    diagnostic.sliceName ? `Slice "${diagnostic.sliceName}"` : undefined,
    diagnostic.scenarioDescription
      ? `scenario "${diagnostic.scenarioDescription}"`
      : undefined,
    diagnostic.location,
    diagnostic.eventType ? `Event "${diagnostic.eventType}"` : undefined,
    diagnostic.path ? `path ${diagnostic.path}` : undefined,
  ].filter(Boolean)
  const prefix = `[${diagnostic.code}]`

  const detail = `${prefix}${context.length > 0 ? ` ${context.join(' › ')}` : ''}: ${diagnostic.message}`
  return diagnostic.remediation
    ? `${detail} Remediation: ${diagnostic.remediation}`
    : detail
}

function issuePath(path: StandardSchemaV1.Issue['path']) {
  if (!path || path.length === 0) return undefined

  return path
    .map((segment) => {
      const key =
        typeof segment === 'object' && segment !== null && 'key' in segment
          ? segment.key
          : segment

      return typeof key === 'symbol'
        ? (key.description ?? key.toString())
        : String(key)
    })
    .join('.')
}

function isKebabCase(value: string) {
  return /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value)
}

function isLowerCamelCase(value: string) {
  return /^[a-z][a-zA-Z0-9]*$/.test(value)
}
