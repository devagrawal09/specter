import { beforeAll, describe, expect, it } from 'vitest'

import {
  assertConforms,
  commandScenarioEventTypes,
  decodeOptionalSchema,
  isScenarioEvent,
  type ApplyEventDefinition,
  type CommandScenario,
  type EventDraft,
  type QueryScenario,
  type ReactionScenario,
  type ScenarioEvent,
  type SliceRegistration,
  valuesEqual,
} from '../definition'

export type ScenarioTestOptions = {
  readonly events: readonly ApplyEventDefinition[]
  readonly runScenario?: <T>(run: () => Promise<T>) => Promise<T>
}

export function testSliceImplementation(
  implementation: SliceRegistration,
  options: ScenarioTestOptions,
) {
  testSliceImplementations([implementation], options)
}

export function testSliceImplementations(
  implementations: readonly SliceRegistration[],
  options: ScenarioTestOptions,
) {
  const runScenario = options.runScenario ?? ((run) => run())

  describe('Specter Slice implementations', () => {
    beforeAll(() =>
      assertConforms({ events: options.events, slices: implementations }),
    )

    for (const implementation of implementations) {
      describe(implementation.description, () => {
        switch (implementation.kind) {
          case 'command':
            for (const scenario of implementation.scenarios) {
              testCommandScenario(
                implementation,
                scenario,
                options.events,
                runScenario,
              )
            }
            break
          case 'query':
            for (const scenario of implementation.scenarios) {
              testQueryScenario(
                implementation,
                scenario,
                options.events,
                runScenario,
              )
            }
            break
          case 'reaction':
            for (const scenario of implementation.scenarios) {
              testReactionScenario(
                implementation,
                scenario,
                options.events,
                runScenario,
              )
            }
            break
        }
      })
    }
  })
}

function testCommandScenario(
  implementation: Extract<SliceRegistration, { kind: 'command' }>,
  scenario: CommandScenario,
  eventDefinitions: readonly ApplyEventDefinition[],
  runScenario: <T>(run: () => Promise<T>) => Promise<T>,
) {
  it(scenario.description, async () => {
    const result = await runScenario(async () => {
      await replay([implementation], eventDefinitions, scenario.given)
      const state = await implementation.store.get(implementation.name)
      const command = await decodeOptionalSchema(
        implementation.inputSchema,
        scenario.when,
      )

      try {
        const events = await implementation.handle(command, state.read)

        if (events.length === 0) {
          throw new Error(`Command emitted no events: ${implementation.name}`)
        }

        const allowedEventTypes = commandScenarioEventTypes(implementation)
        const decodedEvents = await Promise.all(
          events.map(async (draft, index) => {
            if (!allowedEventTypes.has(draft.type)) {
              throw new Error(
                `Command "${implementation.name}" emitted unauthorized Event "${draft.type}" at index ${index}.`,
              )
            }

            return decodeEventDraft(eventDefinitions, draft)
          }),
        )

        return { _tag: 'Right' as const, right: decodedEvents }
      } catch (error) {
        return { _tag: 'Left' as const, left: error }
      }
    })

    if (scenario.expect.length === 0) {
      expect(result._tag).toBe('Left')
      if (scenario.reject) {
        if (result._tag !== 'Left') {
          throw new Error('Command scenario did not reject')
        }
        expect(result.left).toBeInstanceOf(Error)
        expect(result.left).toMatchObject({
          message: scenario.reject.reason,
        })
      }
      return
    }

    if (result._tag === 'Left') {
      throw new Error('Command scenario rejected unexpectedly', {
        cause: result.left,
      })
    }

    expect(result.right).toHaveLength(scenario.expect.length)

    for (const [index, expectedEvent] of scenario.expect.entries()) {
      if (!isScenarioEvent(expectedEvent)) {
        throw new Error(
          'Command scenario expected value is not a ScenarioEvent',
        )
      }

      expect(result.right[index]).toEqual({
        type: expectedEvent.eventType,
        payload: expectedEvent.examplePayload,
      })
    }
  })
}

function testQueryScenario(
  implementation: Extract<SliceRegistration, { kind: 'query' }>,
  scenario: QueryScenario,
  eventDefinitions: readonly ApplyEventDefinition[],
  runScenario: <T>(run: () => Promise<T>) => Promise<T>,
) {
  it(scenario.description, async () => {
    const result = await runScenario(async () => {
      await replay([implementation], eventDefinitions, scenario.given)
      const state = await implementation.store.get(implementation.name)
      const input = await decodeOptionalSchema(
        implementation.inputSchema,
        scenario.when,
      )
      const output = await implementation.handle(input, state.read)

      return decodeOptionalSchema(implementation.outputSchema, output)
    })
    const expected = await decodeOptionalSchema(
      implementation.outputSchema,
      scenario.expect,
    )

    expect(result).toEqual(expected)
  })
}

function testReactionScenario(
  implementation: Extract<SliceRegistration, { kind: 'reaction' }>,
  scenario: ReactionScenario,
  eventDefinitions: readonly ApplyEventDefinition[],
  runScenario: <T>(run: () => Promise<T>) => Promise<T>,
) {
  it(scenario.description, async () => {
    const result = await runScenario(async () => {
      await replay([implementation], eventDefinitions, scenario.given)
      const state = await implementation.store.get(implementation.name)
      const output = await implementation.handle(state.read)

      if (output === undefined) return []

      return [await decodeOptionalSchema(implementation.outputSchema, output)]
    })
    const expected = await Promise.all(
      scenario.expect.map((output) =>
        decodeOptionalSchema(implementation.outputSchema, output),
      ),
    )

    expect(result).toEqual(expected)
  })
}

async function decodeEventDraft(
  eventDefinitions: readonly ApplyEventDefinition[],
  draft: EventDraft,
) {
  const definition = eventDefinitions.find(
    (candidate) => candidate.type === draft.type,
  )
  if (!definition) throw new Error(`Unknown Event type: ${draft.type}`)

  const payload = await definition.decode(draft.payload)
  if (!valuesEqual(payload, draft.payload)) {
    throw new Error(
      `Event schema transformed payload for "${draft.type}". Event payload validation must preserve data one-to-one.`,
    )
  }

  return {
    type: draft.type,
    payload,
  }
}

export async function replay(
  implementations: readonly SliceRegistration[],
  eventDefinitions: readonly ApplyEventDefinition[],
  events: readonly ScenarioEvent[],
) {
  const definitionsByType = new Map(
    eventDefinitions.map(
      (definition) => [definition.type, definition] as const,
    ),
  )

  for (const [index, scenarioEvent] of events.entries()) {
    const definition = definitionsByType.get(scenarioEvent.eventType)
    if (!definition) {
      throw new Error(`Unknown Scenario Event type: ${scenarioEvent.eventType}`)
    }

    const id = `scenario-event-${index + 1}`
    const order = index + 1
    const recordedAt = new Date(0)
    const payload = await definition.decode(scenarioEvent.examplePayload)
    if (!valuesEqual(payload, scenarioEvent.examplePayload)) {
      throw new Error(
        `Event schema transformed Scenario Event payload for "${scenarioEvent.eventType}".`,
      )
    }

    for (const implementation of implementations) {
      const apply = implementation.apply.find(
        (candidate) => candidate.event.type === scenarioEvent.eventType,
      )
      if (!apply) continue

      const state = await implementation.store.get(implementation.name)
      await apply.handle(
        {
          type: scenarioEvent.eventType,
          payload,
          id,
          recordedAt,
        },
        state.write,
      )

      await state.setLastAppliedOrder(order)
    }
  }
}
