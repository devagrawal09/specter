import { beforeAll, describe, expect, it } from 'vitest'
import { Context, Effect } from 'effect'

import type { SliceStoreService } from '../adapters'
import { CommandRejection } from '../runtime/errors'

import {
  assertConforms,
  carriesConsistencyKey,
  commandScenarioEventTypes,
  consistencyKeyValues,
  decodeOptionalSchema,
  eventKeys,
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
  registrations:
    | readonly SliceRegistration[]
    | Readonly<Record<string, SliceRegistration>>,
  options: ScenarioTestOptions,
) {
  const implementations = Array.isArray(registrations)
    ? registrations
    : Object.values(registrations)
  const runScenario =
    options.runScenario ??
    (<T>(program: Effect.Effect<T, unknown, unknown>) =>
      Effect.runPromise(program as Effect.Effect<T, unknown, never>))

  describe('Specter Slice implementations', () => {
    beforeAll(() =>
      Effect.runPromise(
        assertConforms(
          {
            events: options.events,
            slices: Object.fromEntries(
              implementations.map((implementation) => [
                implementation.name,
                implementation,
              ]),
            ),
          },
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
  it(scenario.description, () =>
    checkCommandScenario(
      implementation,
      scenario,
      eventDefinitions,
      runScenario,
    ),
  )
}

/** Runs one Command Scenario; internal seam of the Vitest runner. */
export async function checkCommandScenario(
  implementation: Extract<SliceRegistration, { kind: 'command' }>,
  scenario: CommandScenario,
  eventDefinitions: readonly ApplyEventDefinition[],
  runScenario: <T>(program: Effect.Effect<T, unknown, unknown>) => Promise<T>,
) {
  // Decides from the Given Events, with the keys the decision declares from
  // the State it read.
  const decide = (given: readonly ScenarioEvent[]) =>
    runScenario(
      replay([implementation], eventDefinitions, given).pipe(
        Effect.andThen(
          withStoreRead(implementation, async (state) => {
            let keys: Readonly<Record<string, readonly string[]>> | undefined
            try {
              const command = await decodeOptionalSchema(
                implementation.inputSchema,
                scenario.when,
              )
              keys =
                implementation.consistencyKeys &&
                consistencyKeyValues(
                  implementation.consistencyKeys,
                  command,
                  state,
                )

              const events = await implementation.handle(command, state)

              if (events.length === 0) {
                throw new Error(
                  `Command "${implementation.name}" emitted no Events: a handler emits at least one or throws a CommandRejection.`,
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

              return {
                keys,
                result: { _tag: 'Right' as const, right: decodedEvents },
              }
            } catch (left) {
              return { keys, result: { _tag: 'Left' as const, left } }
            }
          }),
        ),
      ),
    )

  const decided = await decide(scenario.given)
  expectCommandOutcome(decided.result, scenario)

  // A Command that declares consistency keys promises that no Event carrying
  // none of them can change its decision once it has read its State: its
  // append conflicts with no such Event. Each Scenario checks that promise.
  const keys = decided.keys
  if (!keys) return
  const read = untilLast(scenario.given, (given) =>
    carriesConsistencyKey(scenarioEventKeys(eventDefinitions, given), keys),
  )
  if (read.length === scenario.given.length) return
  try {
    expectCommandOutcome((await decide(read)).result, scenario)
  } catch (cause) {
    const named = Object.entries(keys)
      .map(([name, values]) => `${name}: ${values.join(', ')}`)
      .join('; ')
    throw new Error(
      `Command "${implementation.name}" decides scenario "${scenario.description}" differently without its last Given Events, which carry none of its consistency keys (${named}): a writer could append those after it read its State without a conflict. Declare every key its decision reads, or give the Events it reads those keys.`,
      { cause },
    )
  }
}

/**
 * The Events up to the last one `carries` accepts. What follows carries
 * none of a decision's keys, so a concurrent writer could append it after the
 * decision read its State and the scoped compare-and-swap would let both
 * commit: the decision must not depend on it.
 */
function untilLast(
  given: readonly ScenarioEvent[],
  carries: (given: ScenarioEvent) => boolean,
) {
  let last = given.length - 1
  while (last >= 0 && !carries(given[last] as ScenarioEvent)) last -= 1
  return given.slice(0, last + 1)
}

function expectCommandOutcome(
  result:
    | { readonly _tag: 'Left'; readonly left: unknown }
    | { readonly _tag: 'Right'; readonly right: readonly EventDraft[] },
  scenario: CommandScenario,
) {
  if (scenario.expect.length === 0) {
    if (result._tag !== 'Left') {
      throw new Error(
        `Command scenario did not reject; it expected code "${scenario.reject?.code}".`,
      )
    }
    if (!(result.left instanceof CommandRejection)) {
      throw new Error(
        `Command scenario failed instead of rejecting: a handler rejects by throwing a CommandRejection with code "${scenario.reject?.code}".`,
        { cause: result.left },
      )
    }
    expect(result.left.code).toBe(scenario.reject?.code)
    if (scenario.reject?.message !== undefined) {
      expect(result.left.message).toBe(scenario.reject.message)
    }
    if (scenario.reject?.details !== undefined) {
      expect(result.left.details).toEqual(scenario.reject.details)
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
      throw new Error('Command scenario expected value is not a ScenarioEvent')
    }

    expect(result.right[index]).toEqual({
      type: expectedEvent.eventType,
      payload: expectedEvent.examplePayload,
    })
  }
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

/**
 * A Reaction Scenario's `expect` lists what its handler requests after the
 * Given Events: at most one value, or for a keyed Reaction at most one per
 * key the Given Events carry, in the order the keys first appear, as if the
 * Given Events were one commit.
 */
function testReactionScenario(
  implementation: Extract<SliceRegistration, { kind: 'reaction' }>,
  scenario: ReactionScenario,
  eventDefinitions: readonly ApplyEventDefinition[],
  runScenario: <T>(program: Effect.Effect<T, unknown, unknown>) => Promise<T>,
) {
  it(scenario.description, () =>
    checkReactionScenario(
      implementation,
      scenario,
      eventDefinitions,
      runScenario,
    ),
  )
}

/** Runs one Reaction Scenario; internal seam of the Vitest runner. */
export async function checkReactionScenario(
  implementation: Extract<SliceRegistration, { kind: 'reaction' }>,
  scenario: ReactionScenario,
  eventDefinitions: readonly ApplyEventDefinition[],
  runScenario: <T>(program: Effect.Effect<T, unknown, unknown>) => Promise<T>,
) {
  const name = implementation.key
  const keys: readonly (string | undefined)[] =
    name === undefined
      ? [undefined]
      : [
          ...new Set(
            scenario.given.flatMap((given) => {
              const value = scenarioEventKeys(eventDefinitions, given)[name]
              return value === undefined ? [] : [value]
            }),
          ),
        ]
  const handle = (given: readonly ScenarioEvent[], key: string | undefined) =>
    runScenario(
      replay([implementation], eventDefinitions, given).pipe(
        Effect.andThen(
          withStoreRead(implementation, async (state) => {
            const output = await implementation.handle(state, key)
            return output === undefined
              ? []
              : [
                  await decodeOptionalSchema(
                    implementation.outputSchema,
                    output,
                  ),
                ]
          }),
        ),
      ),
    )
  const outputs = await runScenario(
    replay([implementation], eventDefinitions, scenario.given).pipe(
      Effect.andThen(
        withStoreRead(implementation, async (state) => {
          const byKey: unknown[][] = []
          for (const key of keys) {
            const output = await implementation.handle(state, key)
            byKey.push(
              output === undefined
                ? []
                : [
                    await decodeOptionalSchema(
                      implementation.outputSchema,
                      output,
                    ),
                  ],
            )
          }
          return byKey
        }),
      ),
    ),
  )
  expect(outputs.flat()).toEqual(scenario.expect)

  // A keyed Reaction decides each key from that key's Events alone, since
  // only Events carrying a key run its handler.
  if (name === undefined) return
  for (const [index, key] of keys.entries()) {
    if (key === undefined) continue
    const read = untilLast(
      scenario.given,
      (given) => scenarioEventKeys(eventDefinitions, given)[name] === key,
    )
    if (read.length === scenario.given.length) continue
    const alone = await handle(read, key)
    if (!valuesEqual(alone, outputs[index])) {
      throw new Error(
        `Keyed Reaction "${implementation.name}" handles ${name} "${key}" in scenario "${scenario.description}" differently without its last Given Events, which do not carry that key and so would not run its handler: ${JSON.stringify(
          alone,
        )} instead of ${JSON.stringify(outputs[index])}. Its handler must decide each key from that key's State alone.`,
      )
    }
  }
}

function scenarioEventKeys(
  eventDefinitions: readonly ApplyEventDefinition[],
  given: ScenarioEvent,
) {
  return eventKeys(
    eventDefinitions.find((candidate) => candidate.type === given.eventType),
    given.examplePayload,
  )
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

      // A Given Event is recorded as if appended alone at its position: its
      // order is its one-based position, its time that many seconds after
      // the Unix epoch, and its keys those its definition derives.
      const order = index + 1
      const id = `scenario-event-${order}`
      const recordedAt = scenarioRecordedAt(order)
      const payload = yield* Effect.tryPromise({
        try: () => definition.decode(scenarioEvent.examplePayload),
        catch: (cause) => cause,
      })
      if (!valuesEqual(payload, scenarioEvent.examplePayload)) {
        throw new Error(
          `Event schema transformed Scenario Event payload for "${scenarioEvent.eventType}".`,
        )
      }
      const keys = eventKeys(definition, payload)

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
                      order,
                      recordedAt,
                      keys,
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

/**
 * When the Given Event at one-based `order` is recorded in a Scenario: that
 * many seconds after the Unix epoch, so later Events are recorded later.
 */
export function scenarioRecordedAt(order: number) {
  return new Date(order * 1000).toISOString()
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
