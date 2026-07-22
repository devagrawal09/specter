# Testing Slice implementations

Specter executes the Scenarios attached to a completed Slice implementation. The same examples that explain the behavior verify projection replay, decisions, outputs, and declared rejection reasons without sending HTTP requests or starting an app runtime.

## One Slice or a registry

Use `testSliceImplementation` for a focused test file:

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

Use `testSliceImplementations` when one test boundary should exercise the complete feature registry:

```ts
import { testSliceImplementations } from '@specter-ts/core/testing'

testSliceImplementations(todoRegistrations, {
  events: todoEventDefinitions,
  runScenario: sqliteScenario({}),
})
```

Both functions define Vitest suites immediately. They are not async functions to await from a test body.

## Choose the Event catalog deliberately

A whole-feature registry should use its whole Event Definition catalog. Construction conformance then proves every registered Event appears in at least one Given history or accepted Command outcome.

A single-Slice test should normally derive a focused catalog:

```ts
const addTodoEvents = eventsFor(addTodo, todoEventDefinitions)
```

`eventsFor` includes exactly the registered definitions required by:

- the Slice's apply handlers;
- every Event in its Scenario `given` arrays; and
- for a Command, every Event in accepted `expect` arrays.

It rejects duplicate definitions and reports required types missing from the full catalog. It does not silently invent a definition from a Scenario Event. The returned list preserves the full catalog's order.

Passing the full app catalog to an isolated Slice can create a useful but misleading failure: unrelated registered Events have no Scenario coverage in that one Slice. Use `eventsFor` rather than disabling whole-catalog coverage.

## Isolate every Scenario

The optional `runScenario` function wraps one complete Scenario execution:

```ts
type ScenarioTestOptions = {
  readonly events: readonly ApplyEventDefinition[]
  readonly runScenario?: <T>(run: () => Promise<T>) => Promise<T>
}
```

Without it, the runner calls `run()` directly. Supply a wrapper whenever the adapter retains state. A wrapper can create a fresh in-memory store, run a database transaction that rolls back, bind an async-local database connection, or clear tables before the Scenario.

Isolation is part of test correctness. Scenario `given` arrays describe the complete relevant history for that example; state leaked from an earlier Scenario invalidates that contract.

## What replay does

For each Given Scenario Event, `replay`:

1. resolves the Event Definition by type;
2. decodes the example payload and rejects schema transformation;
3. assigns deterministic metadata: `scenario-event-1`, `scenario-event-2`, and so on, with `recordedAt` set to the Unix epoch;
4. calls the matching apply handler on every supplied implementation; and
5. advances each affected Slice cursor to the Event's one-based order.

An implementation without an apply handler for that Event is skipped by `replay`, but conformance rejects a Slice when its own Given data lacks a matching apply registration.

`replay` is also exported for lower-level tests. When calling it directly, provide the same state isolation guarantee that the Scenario runners expect.

## What each runner asserts

### Commands

After replay, the runner decodes `when`, reads the Slice State, and calls the Command handler.

- Accepted Scenarios require one or more emitted Events.
- Every emitted type must appear in an accepted outcome in the Command's specification.
- Emitted payloads are decoded by their Event Definitions and must not be transformed.
- The resulting `{ type, payload }` values must exactly equal the ordered `expect` array.
- Rejected Scenarios require the handler to throw, and the thrown error's message must match `reject.reason`.

### Queries

After replay, the runner decodes `when`, calls the Query handler, decodes the actual output, and compares it exactly with `expect`. The Scenario expectation is already the public post-schema value; it is not passed through the output schema a second time.

### Reactions

After replay, the runner calls the Reaction handler directly. It does not execute the Reaction Plugin. `undefined` becomes `[]`; a returned value is decoded through the output schema and becomes `[value]`. The result must exactly equal `expect`.

This keeps domain effect selection testable without performing provider calls or dispatching same-app Commands. Test a Plugin or outbox worker separately at its infrastructure boundary.

## Schema validation versus domain behavior

Scenarios use schema-valid public inputs. Construction conformance validates every Command and Query `when` example before tests run. An intentionally invalid `when` value therefore does not express “the transport rejects malformed input”; it makes the specification itself non-conforming.

Use separate unit or transport tests for malformed envelopes, schema issue mapping, and HTTP status behavior. Use Slice Scenarios for decisions made after input decoding, such as rejecting a blank but schema-valid Todo title.

## Practical test layers

- **Focused Slice test:** one implementation, `eventsFor`, and an isolated store. Fastest feedback for a feature edit.
- **Feature registry test:** all related implementations and the full feature Event catalog. Finds cross-Slice drift and uncovered Events.
- **Runtime test:** `createSpecterApp` with real or faithful adapters. Covers Event Log transactions, optimistic versions, idempotency, subscriptions, and Reaction scheduling.
- **Transport or end-to-end test:** project-owned envelope mapping and user-visible behavior. Keep this outside the Slice specification suite.

## Common failures

- **Unknown Scenario Event:** add its Event Definition to the supplied catalog.
- **Missing or extra apply handler:** make the implementation's projection inputs match its Given examples.
- **Event payload transformation:** move defaults, coercion, trimming, or field removal out of the Event schema.
- **Unauthorized Command Event:** add the behavior as an accepted Scenario outcome or stop emitting it.
- **Order-dependent Scenario failure:** fix `runScenario` isolation before changing expected values.
- **Whole-catalog event without coverage:** use `eventsFor` for a focused test, or add the missing whole-feature Scenario.

## Related documentation

- [Writing executable specifications](./writing-specifications.md)
- [Conformance](./conformance.md)
- [Core testing API](../api-reference/core-testing.md)
- [Core specification API](../api-reference/spec.md)
- [Runtime architecture](../architecture/runtime.md)
