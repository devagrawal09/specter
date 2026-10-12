# Conformance

Conformance is the boundary between a structurally valid Specter application and runtime behavior. Specter first checks that Event Definitions, completed Slice implementations, Scenarios, and apply registrations describe one coherent executable model. It then keeps validating envelopes, persisted Events, handler outputs, and storage guarantees while the app runs.

Construction conformance answers “can this registry be executed safely?” Slice tests answer “does each implementation satisfy its Scenarios?” Runtime checks answer “does this particular input, Event Log result, and handler result preserve the contract?” All three are required.

## When construction conformance runs

`assertConforms(config)` is native Effect check. `createSpecterApp(config,
dependencies)` runs it while acquiring Promise-edge app:

```ts
import {
  createSpecterApp,
  SpecterConformanceError,
} from '@specter-ts/core'

try {
  const app = await createSpecterApp(
    { events: todoEventDefinitions, slices: todoRegistrations },
    Layer.mergeAll(EventLogLive, TodoStoreLayers),
  )
} catch (cause) {
  if (cause instanceof SpecterConformanceError) {
    for (const diagnostic of cause.diagnostics) {
      console.error(diagnostic.code, diagnostic.message)
    }
  }
  throw cause
}
```

The Slice test runners perform the same check before defining Scenario tests, except a focused test registry is allowed to contain no Command Slice. `SpecterConformanceError` aggregates all discovered diagnostics so one run can drive a coherent fix rather than exposing one error at a time.

## Construction checks

### Event catalog

| Diagnostic | Condition |
| --- | --- |
| `duplicate-event-type` | More than one Event Definition registers the same type. |
| `event-type-format` | An Event type is not kebab-case, such as `todo-added`. |
| `event-without-scenario` | A registered Event never appears in a Given history or accepted Command outcome. |

Each Event Definition is the single runtime decoder for that type. Whole-app construction requires every definition to have executable Scenario coverage.

### Slice registry

| Diagnostic | Condition |
| --- | --- |
| `missing-command-slice` | A whole app has no completed Command Slice. |
| `duplicate-slice-name` | More than one implementation uses the same Slice name. |
| `incomplete-slice` | A specification-stage value is registered instead of a completed implementation. |
| `empty-slice-name` | A Slice name is blank. |
| `slice-name-format` | A Slice name is not lower camel case, such as `addTodo`. |
| `empty-slice-description` | A Slice description is blank. |
| `missing-scenarios` | A Slice has no Scenario. |

### Scenarios and schemas

| Diagnostic | Condition |
| --- | --- |
| `empty-scenario-description` | A Scenario description is blank. |
| `duplicate-scenario-description` | Two Scenarios in one Slice have the same description. |
| `invalid-scenario-event` | A Given or accepted Command outcome is not the branded value returned by `event(...)`. |
| `unknown-scenario-event` | A Scenario Event type has no Event Definition in the supplied catalog. |
| `event-payload-schema` | A Scenario Event payload fails its Event schema. |
| `event-payload-transformation` | The Event schema changes, strips, coerces, or generates payload data. |
| `event-keys` | A key function of the Event Definition returns something other than a string or `undefined` for a Scenario Event's payload. |
| `event-key-name` | An Event Definition declares a key name that is not lower camel case. |
| `event-missing-key` | A Scenario Event (Given or accepted outcome, in any Slice) carries none of the key names of a keyed Slice that applies its type. |
| `rejection-code` | A rejected Command Scenario names no kebab-case `reject.code`. |
| `command-input-schema` | A Command Scenario's `when` example fails its input schema. |
| `query-input-schema` | A Query Scenario's `when` example fails its input schema. |

Query and Reaction `expect` values are public post-output-schema values. Construction does not decode them again because Standard Schema defines the raw-input-to-public-output direction; executable Slice tests decode actual handler outputs once and compare them directly.

### Apply registrations

| Diagnostic | Condition |
| --- | --- |
| `duplicate-apply-handler` | A Slice registers more than one apply handler for the same Event type. |
| `unknown-apply-event` | An apply registration uses a type absent from the app Event catalog. |
| `apply-event-definition-identity` | An apply registration uses a different Event Definition object than the exact instance in the catalog. |
| `missing-apply-handler` | An Event appears in that Slice's Given data but has no matching apply handler. |
| `extra-apply-handler` | A Slice applies an Event that never appears in its Given data. |
| `keyed-reaction-undeclared-key` | A keyed Reaction (`.handleEachKey(name, ...)`) applies an Event type whose definition does not declare its key, which could never run its handler. |
| `keyed-command-undeclared-key` | A Command with consistency keys applies an Event type that declares none of its key names, so no Event of it could ever conflict. |
| `keyed-command-unused-key` | A Command names a consistency key that no Event type it applies declares. |

These checks keep each Slice's declared history and projection code in lockstep. They also make a focused test's Event requirements derivable with `eventsFor(slice, fullCatalog)`.

#### Why Given types and applied types match exactly

The Event types a Slice applies are what it reads: they are its catch-up query, the scope of a Command's compare-and-swap, and what makes a commit relevant to a Reaction. Each direction of the rule protects one of those:

- **Every applied type is given (`extra-apply-handler`).** An apply handler no Scenario gives is a fold input nothing executes: it changes decisions, widens what a Command conflicts with and when a Reaction runs, yet the specification never shows it. Relaxing this to a warning would let a Slice read history its contract does not mention; Specter reports conformance as failures, not warnings, so the cost of a forgotten Scenario is caught at construction.
- **Every given type is applied (`missing-apply-handler`).** The runtime never delivers an Event a Slice does not apply, so a Given Event of such a type cannot affect the outcome: a Scenario that gives it shows nothing the Slice could have done differently, and is more often a fold the author forgot than a statement of indifference. The rule turns that mistake into a diagnostic. To show that a Slice ignores a fact, leave the fact out of its history: an Event type the Slice does not apply cannot reach its decision.

## Runtime protections

Construction cannot execute arbitrary handlers or predict adapter behavior. The runtime therefore guards the live path:

- **Envelope routing:** unknown Command and Query types throw `SpecterUnknownCommandError` and `SpecterUnknownQueryError`.
- **Command options:** `expectedVersion` must be a non-negative safe integer; an idempotency key must be non-blank; `idempotencyMode` must be `first-wins` or `exact` and requires an idempotency key; idempotent Command payloads must be structurally serializable.
- **Input and output schemas:** Command and Query inputs are decoded before their handlers; Query and Reaction outputs are decoded afterward. Failures become the corresponding public input or output error.
- **Persisted Event decoding:** emitted and replayed payloads must pass the registered Event schema without transformation. Unknown Event types fail closed.
- **Event Log order:** query results must have unique, strictly increasing safe-integer orders greater than the requested cursor.
- **Optimistic decisions:** Command catch-up, decision, and append occur inside one Event Log transaction. Without a caller `expectedVersion`, append is stale only when an Event of a type the Command applies, carrying one of its consistency keys under that name when it declares them, was appended after its State was read; the Event Log checks it in its store, from the keys stored with each Event, and core then decides again, up to 32 times. A caller `expectedVersion` compares against the whole log.
- **Event keys:** core derives every emitted Event's keys before the append, and stores them with it. Each must be a string or `undefined`, and an Event must carry one of the key names of every keyed Slice that applies its type; otherwise the Command fails with `SpecterInfrastructureError` and appends nothing. Every Event an Event Log returns must carry the keys stored with it (`keys`, an object of strings), or the read fails with `SpecterInfrastructureError`. A keyed Reaction handles the stored values, and fails the same way on an Event without its key.
- **Host context:** `eventContext` must be a function. What it returns for an Event must be `undefined` or an object whose `id`, when present, is a non-blank string no other Event of the commit has, and whose `recordedAt`, when present, is an ISO-8601 UTC timestamp as `Date.prototype.toISOString` writes it; otherwise the Command fails with `SpecterInvalidCommandOptionsError` and appends nothing. A context function that throws fails it with `SpecterInfrastructureError`. The Event Log fails an append whose ID is already in the log.
- **Event Log capabilities:** the runtime refuses to start with `SpecterEventLogCapabilityError` on an Event Log without scoped appends when the app has a Command, or without keyed reads when the host requires them.
- **Idempotency:** a repeated key returns the earlier commit with `duplicate: true`, even for a different envelope. With `idempotencyMode: 'exact'`, using that key for a different canonical envelope throws `SpecterIdempotencyConflictError`.
- **Command outcomes:** a Command rejects only when its handler throws a `CommandRejection` whose code appears in one of its rejected Scenarios. A code none names, any other thrown error, and a handler that returns no Events fail with `SpecterInfrastructureError`. Every emitted Event type must appear in at least one accepted Scenario outcome for that Command.
- **Projection publication:** Slice State changes remain staged until the cursor advances. Failed projections are disposable and replayable from the authoritative Event Log.
- **Reaction effects:** a Reaction cursor advances only after its Plugin executor succeeds. Independent Reaction failures are collected in `ReactionRunFailure` after the pass settles.

Adapter or handler failures that are not already public Specter errors are wrapped in `SpecterInfrastructureError` with the original cause. Consumers can branch on `SpecterError.code` or the exported `specterErrorCodes` without parsing messages.

## Diagnostic workflow

1. Read every diagnostic in `SpecterConformanceError.diagnostics`; fixing one structural issue can clarify several downstream messages.
2. Fix the specification when the behavior contract is wrong: Event type, Scenario Event, description, input example, or accepted Command outcome.
3. Fix the implementation when the specification is right: use the registered Event Definition instance, align apply handlers, or complete the builder chain.
4. For a focused single-Slice test, derive its catalog with `eventsFor` instead of passing unrelated Event Definitions.
5. Run the Slice tests to execute handler behavior after construction passes.
6. Run a runtime test with intended Event Log and Slice Store adapters to verify transaction, ordering, idempotency, and recovery guarantees.

Do not suppress a diagnostic by duplicating definitions, weakening Event schemas, or adding unused apply handlers. Conformance is designed to keep the executable specification and runtime registry inspectably exact.

## Related documentation

- [Writing executable specifications](./writing-specifications.md)
- [Testing Slice implementations](./slice-tests.md)
- [Core runtime API](../api-reference/core-runtime.md)
- [Core testing API](../api-reference/core-testing.md)
- [Event sourcing](../architecture/event-sourcing.md)
- [Runtime architecture](../architecture/runtime.md)
