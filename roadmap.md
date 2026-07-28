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
