# Core testing API

**Import:** `@specter-ts/core/testing`

**Status:** `0.4.0` main-branch preview; the published npm release remains `0.2.1`.

The testing entrypoint turns a Slice's executable Scenarios into Vitest tests, replays Scenario Events into isolated Slice State, derives focused Event catalogs, and reports where an Event contract propagates. It is intended for tests and development tooling, not application runtime code.

## Public values

| Export | Signature | Purpose |
| --- | --- | --- |
| `testSliceImplementation` | `(implementation, options) => void` | Defines Vitest tests for one completed Slice implementation. |
| `testSliceImplementations` | `(implementations, options) => void` | Defines Vitest tests for a registry of completed Slice implementations. |
| `replay` | `(implementations, eventDefinitions, events) => Effect<void, ...>` | Validates and applies Scenario Events in order, then publishes each affected Slice cursor. |
| `eventsFor` | `(slice, fullCatalog) => readonly ApplyEventDefinition[]` | Selects the Event Definitions needed by one Slice's Given Events, apply handlers, and accepted Command outcomes. |
| `analyzeEventPropagation` | `(input, eventType?) => readonly EventPropagation[]` | Finds each Scenario producer/example and apply consumer for one Event type or the complete catalog. |
| `formatEventPropagation` | `(propagation) => string` | Formats one propagation report for terminal or review output. |
| `eventLogConformance` | `(serviceEffect) => Effect<void, AdapterConformanceFailure | ...>` | Checks ordering, idempotency, and filtered queries. |
| `sliceStoreConformance` | `(options) => Effect<void, AdapterConformanceFailure | ...>` | Checks publication, isolation, and rollback. |
| `reactionSchedulerConformance` | `(serviceEffect) => Effect<void, AdapterConformanceFailure | ...>` | Checks delivery metadata and completion. |
| `testEventLogService` | `(name, factory) => void` | Thin Vitest runner over Event Log conformance. |
| `testSliceStoreService` | `(name, options) => void` | Thin Vitest runner over Store conformance. |
| `testReactionSchedulerService` | `(name, factory) => void` | Thin Vitest runner over scheduler conformance. |

## Public types

| Export | Meaning |
| --- | --- |
| `CommandScenario` | Accepted or rejected Command example with `given`, `when`, and Event `expect` values. |
| `QueryScenario` | Query example with `given`, `when`, and a public output `expect` value. |
| `ReactionScenario` | Reaction example with `given` and zero or one expected public effect. |
| `ScenarioEvent` | Branded Event example created by `event(type, payload)`. |
| `ScenarioTestOptions` | Test configuration: `events` plus an optional `runScenario` isolation wrapper. |
| `EventPropagationInput` | Event Definition catalog and completed Slice registry to analyze. |
| `EventPropagation` | One Event Definition with its producers, consumers, and Scenario examples. |
| `EventScenarioReference` | Location of an Event in a Scenario `given` or Command `expect` array. |
| `EventApplyReference` | Location of an Event apply handler on a Slice. |

## Test lifecycle

Both test runners first call the same conformance check used to construct an app, with `requireCommandSlice: false`. They then execute every Scenario in declaration order:

1. `replay` validates each Scenario Event against its registered Event Definition, assigns deterministic test metadata, and calls matching apply handlers.
2. The runner loads the Slice's read state and validates/transforms the `when` input when an input schema exists.
3. A Command handler must either throw or emit one or more authorized Events; a Query returns one result; a Reaction returns one effect or `undefined`.
4. Event drafts and actual Query or Reaction outputs pass through their runtime schemas before comparison.
5. The runner compares exact values with `expect(...).toEqual(...)`.

`runScenario` receives Effect program and wraps whole replay-and-execute
operation. Use it to provide Store Layers, create a transaction, reset memory
service, or otherwise isolate State between Scenarios. Runner does not reset
supplied Store automatically.

## Minimal Todo test

```ts
import {
  eventsFor,
  testSliceImplementation,
} from '@specter-ts/core/testing'

import { sqliteScenario } from '../../db/scenario-tests'
import { addTodo } from './add-todo/impl'
import { todoEventDefinitions } from './events'

testSliceImplementation(addTodo, {
  events: eventsFor(addTodo, todoEventDefinitions),
  runScenario: sqliteScenario({}),
})
```

Use `testSliceImplementations(todoRegistrations, { events: todoEventDefinitions, ... })` for whole-feature conformance and interaction through a shared Scenario isolation boundary.

## Focused Event catalogs

Passing the whole app catalog to a single-Slice test can fail whole-catalog coverage for Events unrelated to that Slice. `eventsFor` keeps the test focused while remaining fail-closed:

- It includes Event types used by the Slice's `apply` registrations.
- It includes Scenario `given` Event types.
- For Commands, it also includes accepted `expect` Event types.
- It rejects duplicate definitions in the full catalog.
- It rejects a required Event type missing from the full catalog.
- It preserves the full catalog's original order.

## Event propagation

Use propagation analysis before changing an Event payload:

```ts
import {
  analyzeEventPropagation,
  formatEventPropagation,
} from '@specter-ts/core/testing'

const [report] = analyzeEventPropagation(
  { events: todoEventDefinitions, slices: todoRegistrations },
  'todo-added',
)

console.log(formatEventPropagation(report))
```

The report is static: it reads the supplied executable registry and does not discover files or mutate code. It identifies Command outcomes, every Given example, and apply consumers that must be reviewed together.

## Constraints and failure behavior

- These helpers require Vitest when the test runners are used. The peer dependency is optional so runtime-only consumers do not need Vitest.
- `replay` accepts only branded Scenario Events from `event(...)`, not ordinary runtime Event drafts.
- Scenario Event payload schemas must preserve data one-to-one; coercing, stripping, or defaulting Event payload fields fails conformance or replay.
- Invalid `when` input is not a Scenario language for testing transport validation. Command and Query Scenario inputs must already conform to their input schemas.
- Accepted Command Events must match the exact ordered payloads declared in `expect` and must be authorized by at least one accepted Scenario outcome.
- A rejected Command Scenario expects the handler to throw. When `reject.reason` is present, the error message must match it.
- Query and Reaction expectations are public post-schema values. The actual handler output is decoded once and compared directly with `expect`.
- A Reaction Scenario represents zero effects with `[]` and one effect with `[effect]`; one handler execution cannot assert multiple effects.

## Related documentation

- [Writing executable specifications](../specifications/writing-specifications.md)
- [Testing Slice implementations](../specifications/slice-tests.md)
- [Conformance](../specifications/conformance.md)
- [Core specification API](./core-spec.md)
- [Core runtime API](./core-runtime.md)
