# Roadmap

Specter is exploring how to make coding-agent output easier to constrain and
verify. The goal is not to make code generation deterministic. The goal is to
put a deterministic harness around generated implementations.

This roadmap describes directions, not release commitments. Items may change as
we test them against real applications and non-TypeScript runtimes.

## Current Foundation

Specter already provides the contract that the rest of this work can build on:

- Portable Slice specifications with concrete scenarios.
- A narrow implementation shape for Commands, Queries, and Reactions.
- Startup checks for registrations, schemas, examples, and Event coverage.
- Runtime checks that operations and emitted Events were declared.
- Event Log and Slice Store adapters that own persistence and consistency
  mechanics.
- An independent Go reference runtime that validates portable specifications
  and publishes observations through the same language-neutral formats.

The next steps should reuse existing tools where they provide stronger and
simpler guarantees than custom Specter machinery.

## Typed Capabilities With Effect

Slice handlers should express infrastructure access through Effect services.
Using a service then adds it to the handler's inferred requirements instead of
requiring a separate capability declaration.

For example, a Command handler may require read-only Slice state:

```ts
Effect<
  ReadonlyArray<RefundEvent>,
  RefundError,
  ReadRefundState
>
```

An implementation that also requires `FileSystem` or `HttpClient` should expose
that requirement to the type checker. The implementation builder can reject
requirements outside the set allowed for that Slice kind.

This direction should include checks that prevent generated implementations
from hiding requirements:

- Do not allow `Effect.run*` inside Slice implementations.
- Do not allow implementations to provide live Layers locally.
- Reject unsafe casts that narrow Effect error or requirement channels.
- Keep read and write state capabilities separate.
- Keep runtime and adapter construction at the application boundary.

Effect makes declared services visible. It does not stop ordinary TypeScript
from using ambient APIs, so this work does not replace import checks or runtime
isolation.

## Go Runtime Maturity And Rust Support

Specter's portable specifications should describe the same behavior regardless
of the implementation language.

The repository already contains an independent Go 1.24 reference runtime. It
supports Commands, Queries, Reactions, subscriptions, exact Scenarios,
expected-version checks, idempotency, and runtime observations. Its Event Log
is currently in memory, and SQLite, Postgres, and durable Reaction delivery
remain specific to the TypeScript runtime.

The next step for Go is to turn that reference into supported runtime packages:

- Bind implementations to validated `spec.json` documents so Scenarios do not
  have to be restated by hand.
- Publish a versioned Go module with language-native loaders, builders, and a
  starter application.
- Add persistent Event Log, Slice Store, and Reaction outbox adapters.
- Run the same black-box runtime and adapter conformance cases used by
  TypeScript.

Rust support should start from the same portable documents and conformance
cases. It should provide language-native builders and errors rather than copy
the TypeScript API line for line. Rust is also a useful first implementation
language for the proposed WASI Slice boundary.

A shared parity suite should cover:

- Portable specification validation, canonical digests, and shared fixtures.
- Command commit, rejection, expected-version, and idempotency behavior.
- Query projection and latest-state subscription behavior.
- Reaction delivery IDs, retries, cursor progress, and outbox recovery.
- Structured errors and observation protocol output.
- Rejection of undeclared Events and non-conforming implementations.

This lets teams use Specter in existing Go and Rust services without moving
their domain code to TypeScript. It also tests whether Specter's contracts are
actually language-neutral instead of only described that way. Cross-language
parity does not require every runtime to share an implementation or database
driver; it requires them to pass the same observable contract.

## First-Party WebSocket Transport

Core should remain transport-agnostic, but projects should not have to invent a
different real-time protocol for every application. Specter will explore a
versioned WebSocket binding for its existing Command, Query, subscription, and
Reaction-ticket semantics.

The binding should include a TypeScript browser client and server adapters for
the TypeScript, Go, and Rust runtimes. A small language-neutral message format
could carry operations such as:

```json
{
  "version": 1,
  "id": "request-42",
  "operation": "query.subscribe",
  "type": "todosQuery",
  "payload": { "status": "active" }
}
```

One connection could then carry request/response traffic, latest-state Query
updates, cancellation, and separate Reaction completion updates. This is useful
for live dashboards, collaborative applications, and agent interfaces that
currently need a mixture of HTTP, SSE, and polling.

The transport must define more than message shapes:

- Registered operation allowlists and schema validation at the server edge.
- Authentication, origin checks, message-size limits, and connection limits.
- Request IDs, cancellation, heartbeats, and clean shutdown.
- Per-subscription backpressure that preserves Specter's latest-state
  coalescing behavior.
- Reconnect behavior that creates a fresh Query subscription and sends its
  current value; it must not pretend that Query updates are durable Event
  history.
- Command retry rules that require an idempotency key before a client retries
  an uncertain commit.
- Stable error codes and a separate durable-commit/Reaction-completion
  lifecycle.

The wire contract should be tested with shared fixtures so a browser client can
talk to any supported runtime. It should stay separate from the
observation-only protocol and should not turn Core into a network framework.
The design will follow the two-way messaging model defined by
[RFC 6455](https://www.rfc-editor.org/rfc/rfc6455).

## Alchemy Deployment Adapters

For TypeScript deployments, Specter will evaluate
[Alchemy v2](https://v2.alchemy.run/) as the bridge between Effect services and
cloud resources. Alchemy v2 is currently beta, so this work should begin as an
optional integration rather than a required Specter dependency.

Alchemy resources, providers, and bindings are themselves Effects. A binding
can connect a resource to a Worker or Lambda, expose a typed runtime client, and
create the required platform binding, environment value, or IAM policy. Its
[binding model](https://v2.alchemy.run/infrastructure-as-effects/binding/) can
therefore carry Specter's dependency information past the application boundary
and into deployment.

The intended shape is:

```ts
const dependencies = Layer.mergeAll(
  Layer.succeed(EventLog, eventLogFromDatabase),
  sliceStoresFromDatabase,
  reactionSchedulerFromQueue,
)

const app = await createSpecterApp(config, dependencies)
```

Slice implementations would continue to depend only on their Store Tags and
approved services. The application Layer would choose the real database,
queue, and compute platform. Alchemy would provision and bind those resources,
while Specter adapters would implement the Event Log, Slice Store, scheduler,
and outbox contracts.

The first prototypes should:

- Package the existing Postgres adapter with an Alchemy-managed Neon database.
- Evaluate Cloudflare D1 and Durable Objects, and AWS DynamoDB, against
  Specter's transaction and idempotency requirements before calling them
  adapters.
- Evaluate Cloudflare Queues and AWS SQS for Reaction wakeups and outbox
  workers without making a queue the source of truth.
- Generate starter stacks for Workers and Lambda with only the permissions
  required by the selected bindings.
- Run adapter conformance tests against short-lived live stacks in CI.

This can remove manual environment-variable, resource-name, IAM, and deployment
wiring. Alchemy [Layers](https://v2.alchemy.run/infrastructure-as-effects/layers/)
also make it possible to swap a live database implementation for a memory test
Layer without changing Slice code. Once the integration Layers exist, a missing
resource binding or incompatible deployment host can become a type error
instead of a deployment-time surprise.

Alchemy does not provide Specter's consistency guarantees by itself. A resource
is a valid Specter adapter only after it proves atomic Event commits, durable
idempotency receipts, Store state/cursor atomicity, safe concurrency, and
recoverable Reaction delivery. The integration should reject cloud primitives
that cannot meet those contracts instead of weakening the contracts.

## Resolved Dependency Rules

TypeScript project tooling should use the language's resolved module graph
rather than maintain a custom direct-import scanner.

We will evaluate `dependency-cruiser` for rules such as:

- A Slice cannot import another Slice implementation.
- Slice code cannot reach infrastructure implementations, including
  transitively.
- Generated implementation files can import only their specification, owned
  domain files, Effect, and approved Specter packages.
- Dynamic imports, Node built-ins, undeclared packages, and unsafe dependency
  categories are rejected.
- Path aliases, package exports, workspace packages, and type-only imports are
  resolved consistently with the project.

These checks belong in language-specific, read-only project tooling. Specter
Core and portable specifications will remain language-neutral.

## Tests Generated From Schemas

Examples and Given/When/Then scenarios remain the main executable statement of
intent. They can be supplemented with generated verification.

For TypeScript implementations, Effect Schema can produce `fast-check`
generators for valid inputs. The harness can then:

- Run handlers against many schema-valid values.
- Shrink failures to small, reproducible counterexamples.
- Generate sequences of Commands and Events for model-based testing.
- Explore controlled asynchronous orderings.
- Save the seed and smallest counterexample in the verification result.

Generated cases cannot discover missing business rules. Humans still need to
state invariants such as "an approved refund cannot be cancelled." The
generator's job is to search for violations of stated rules.

## Constrained TypeScript Execution

Static checks should be backed by runtime restrictions.

We will prototype running TypeScript verification in a separate Deno process
with:

- No filesystem, network, environment, subprocess, or FFI access by default.
- Permission prompts disabled.
- A frozen lockfile and cached dependencies.
- Explicit time, output-size, and Event-count limits.
- Only the candidate implementation and declared verification inputs mounted.

Deno permissions provide a useful default boundary, but they are not sufficient
for fully untrusted code. The prototype should keep a path to stronger OS or
microVM isolation and must not grant subprocess or native-library access.

## Verification Attestations

A verification result should be bound to the exact artifact that was checked.
Instead of inventing a private receipt format, Specter will evaluate in-toto
attestations and SLSA provenance conventions.

An attestation should identify:

- The implementation artifact digest.
- The portable specification digest.
- The verifier and policy versions.
- Resolved dependency inputs.
- Checks performed and their results.
- Seeds and counterexamples from generated tests.
- The trusted builder that produced the evidence.

Deployment tooling can then require an attestation whose subject matches the
artifact being deployed. An attestation proves which checks ran against which
artifact; it does not prove that the specification or checks were complete.

## Language-Neutral Isolation With WASI

The longer-term direction is to evaluate WebAssembly Components as a portable
Slice execution boundary.

A component would implement a small Slice interface and import only capabilities
provided by the Specter host:

```wit
world specter-slice {
  import read-state: func() -> list<u8>;
  export handle: func(input: list<u8>) -> result<list<u8>, string>;
  export apply: func(event: list<u8>) -> result<list<u8>, string>;
}
```

Wasmtime and WASI could provide:

- No ambient host access.
- Explicit filesystem, network, clock, and randomness capabilities.
- Memory isolation.
- CPU budgets through deterministic fuel.
- Termination of infinite loops.
- A common runtime boundary for multiple implementation languages.

This is exploratory. TypeScript-to-Component tooling, performance, debugging,
and the evolving Component Model must be proven before this can become a
default runtime.

## What Remains Specter's Responsibility

These tools can remove plumbing, but they do not replace Specter's domain and
consistency guarantees:

- Specification conformance and scenario execution.
- Allowed operation and output Event checks.
- Replay and domain invariant verification.
- Atomic Event commits and optimistic concurrency.
- Durable idempotency receipts.
- Projection state and cursor consistency.
- Reaction delivery and outbox semantics.
- Clear application, Slice, and Event Log ownership.

They also cannot decide whether requirements are complete, an architecture is
maintainable, or a behavior is acceptable to users. Those decisions continue
to require human judgment.
