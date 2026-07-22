import { beforeAll, describe, expect, it } from 'vitest'
import { Context, Effect } from 'effect'

import type { SliceStoreService } from '../adapters'

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
  readonly runScenario?: <T>(
    program: Effect.Effect<T, unknown, unknown>,
  ) => Promise<T>
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
  const runScenario =
    options.runScenario ??
    (<T>(program: Effect.Effect<T, unknown, unknown>) =>
      Effect.runPromise(program as Effect.Effect<T, unknown, never>))

  describe('Specter Slice implementations', () => {
    beforeAll(() =>
      Effect.runPromise(
        assertConforms(
          { events: options.events, slices: implementations },
          { requireCommandSlice: false },
        ),
      ),
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
  runScenario: <T>(program: Effect.Effect<T, unknown, unknown>) => Promise<T>,
) {
  it(scenario.description, async () => {
    const result = await runScenario(
      replay([implementation], eventDefinitions, scenario.given).pipe(
        Effect.andThen(
          Effect.result(
            withStoreRead(implementation, async (state) => {
              const command = await decodeOptionalSchema(
                implementation.inputSchema,
                scenario.when,
              )

              const events = await implementation.handle(command, state)

              if (events.length === 0) {
                throw new Error(
                  `Command emitted no events: ${implementation.name}`,
                )
              }

              const allowedEventTypes =
                commandScenarioEventTypes(implementation)
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

              return decodedEvents
            }),
          ).pipe(
            Effect.map((result) =>
              result._tag === 'Failure'
                ? { _tag: 'Left' as const, left: result.failure }
                : { _tag: 'Right' as const, right: result.success },
            ),
          ),
        ),
      ),
    )

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
  runScenario: <T>(program: Effect.Effect<T, unknown, unknown>) => Promise<T>,
) {
  it(scenario.description, async () => {
    const result = await runScenario(
      replay([implementation], eventDefinitions, scenario.given).pipe(
        Effect.andThen(
          withStoreRead(implementation, async (state) => {
            const input = await decodeOptionalSchema(
              implementation.inputSchema,
              scenario.when,
            )
            const output = await implementation.handle(input, state)

            return decodeOptionalSchema(implementation.outputSchema, output)
          }),
        ),
      ),
    )
    expect(result).toEqual(scenario.expect)
  })
}

function testReactionScenario(
  implementation: Extract<SliceRegistration, { kind: 'reaction' }>,
  scenario: ReactionScenario,
  eventDefinitions: readonly ApplyEventDefinition[],
  runScenario: <T>(program: Effect.Effect<T, unknown, unknown>) => Promise<T>,
) {
  it(scenario.description, async () => {
    const result = await runScenario(
      replay([implementation], eventDefinitions, scenario.given).pipe(
        Effect.andThen(
          withStoreRead(implementation, async (state) => {
            const output = await implementation.handle(state)

            if (output === undefined) return []

            return [
              await decodeOptionalSchema(implementation.outputSchema, output),
            ]
          }),
        ),
      ),
    )
    expect(result).toEqual(scenario.expect)
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

export function replay(
  implementations: readonly SliceRegistration[],
  eventDefinitions: readonly ApplyEventDefinition[],
  events: readonly ScenarioEvent[],
) {
  return Effect.gen(function* () {
    const definitionsByType = new Map(
      eventDefinitions.map(
        (definition) => [definition.type, definition] as const,
      ),
    )

    for (const [index, scenarioEvent] of events.entries()) {
      const definition = definitionsByType.get(scenarioEvent.eventType)
      if (!definition) {
        throw new Error(
          `Unknown Scenario Event type: ${scenarioEvent.eventType}`,
        )
      }

      const id = `scenario-event-${index + 1}`
      const order = index + 1
      const recordedAt = '1970-01-01T00:00:00.000Z'
      const payload = yield* Effect.tryPromise({
        try: () => definition.decode(scenarioEvent.examplePayload),
        catch: (cause) => cause,
      })
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

        yield* withStoreTransaction(
          implementation,
          (write, _read, _cursor, publishCursor) =>
            Effect.gen(function* () {
              yield* Effect.tryPromise({
                try: () =>
                  apply.handle(
                    {
                      type: scenarioEvent.eventType,
                      payload,
                      id,
                      recordedAt,
                    },
                    write,
                  ),
                catch: (cause) => cause,
              })
              yield* publishCursor(order)
            }),
        )
      }
    }
  })
}

function resolveStore(implementation: SliceRegistration) {
  return Effect.gen(function* () {
    const context = yield* Effect.context<never>()
    const found = Context.getOption(context, implementation.store as never)
    if (found._tag === 'None') {
      return yield* Effect.fail(
        new Error(
          `Missing Slice Store Layer for "${implementation.name}" (${implementation.store.key}).`,
        ),
      )
    }
    return found.value as SliceStoreService<unknown, unknown, unknown>
  })
}

function withStoreRead<T>(
  implementation: SliceRegistration,
  run: (state: unknown, cursor: number) => Promise<T>,
) {
  return resolveStore(implementation).pipe(
    Effect.flatMap((store) =>
      store.read(implementation.name, (state, cursor) =>
        Effect.tryPromise({
          try: () => run(state, cursor),
          catch: (cause) => cause,
        }),
      ),
    ),
  )
}

function withStoreTransaction<T>(
  implementation: SliceRegistration,
  run: Parameters<
    SliceStoreService<unknown, unknown, unknown>['transaction']
  >[1],
) {
  return resolveStore(implementation).pipe(
    Effect.flatMap((store) => store.transaction(implementation.name, run)),
  ) as Effect.Effect<T, unknown>
}
