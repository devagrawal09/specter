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
- An independent Go reference runtime that validates portable specifications.
- Codemod packages for the JSON-spec migration and report-only, workspace-wide
  source analysis.

The next steps should reuse existing tools where they provide stronger and
simpler guarantees than custom Specter machinery.

## Visual Slice Scenario Editor

`@specter-ts/spec-editor` now edits committed portable Slice specifications in
a local three-column browser UI. It discovers `src/features/**/spec.json`,
validates every save, and protects dirty drafts from disk conflicts.

The editor should support:

- Creating Command, Query, and Reaction specifications.
- Adding, reordering, duplicating, and removing Scenarios.
- Editing Given Events, Command or Query inputs, expected Events, Query
  results, Reaction outputs, and exact rejection reasons.
- Reusing Event types and example payloads from the other Slices in the
  workspace.
- Importing an existing `spec.json` without losing information.
- Showing schema errors, duplicate names, invalid Event names, and incomplete
  Scenarios while editing.
- Exporting canonical `spec.json` with the same digest as the CLI and other
  language implementations.

The visual editor and `spec.ts` remain two authoring tools for the same portable
document during migration. Adjacent `spec.ts` makes generated JSON read-only.
The editor must not add layout, comments, source locations, or UI state to
`spec.json`.

Round-trip tests should prove that importing and exporting a valid document
does not change its meaning or digest. Structural validation must also remain
separate from implementation verification: a well-formed Scenario is not proof
that an implementation passes it.

Runtime analysis is separate. TypeScript core emits native Effect spans and
applications choose their own OpenTelemetry exporter and trace backend.

## Collaborative Specification Workspaces

Teams should be able to edit a set of Slice specifications together in a
shared workspace. The dashboard can provide the UI, while an optional,
self-hostable collaboration service owns shared drafts, access control, and
history.

Collaboration should include:

- Live cursors, selections, presence, and reconnecting edits.
- Conflict-free convergence when several people edit the same Scenario.
- Viewer, editor, and publisher roles.
- Comments and review threads attached to fields and Scenarios.
- An application-wide view that catches duplicate Slice names and unresolved
  Event references.
- Named checkpoints, revision history, comparison, and restoration.
- Deterministic download of one `spec.json` or a bundle of all specifications.

Presence, comments, permissions, and edit history are collaboration data. They
must not appear in the portable specification.

A shared draft may be temporarily incomplete and may still be downloaded for
local work. Automated implementation and deployment should accept only an
explicit publish operation that:

1. validates the whole workspace;
2. freezes an immutable revision;
3. computes the canonical digest of every specification; and
4. records a small revision manifest that points to those exact documents.

The manifest is coordination metadata, not a new behavioral specification
format. A later edit creates another draft and cannot silently alter a published
revision.

## Specification-To-Preview Pipeline

An optional delivery service should take a published collaborative revision,
build an implementation in the background, and return a preview environment
with a draft pull request.

```text
Collaborative draft
  -> published specification revision
  -> isolated branch and draft pull request
  -> coding agent implementation
  -> deterministic verification
  -> preview deployment and evidence
```

The pipeline should start only after an explicit **Create preview** action or an
approved repository policy. It should not deploy every collaborative
keystroke.

Each run should:

1. Pin the repository commit, published revision, and specification digests.
2. Create an isolated branch or worktree and open a draft pull request.
3. Place the specifications only in their configured feature paths.
4. Run a coding agent with the dependency, capability, filesystem, and runtime
   restrictions described elsewhere in this roadmap.
5. Run specification conformance, exact Scenarios, dependency checks,
   generated tests, runtime tests, and the project build.
6. Deploy the verified commit to a short-lived preview environment.
7. Update the pull request with the preview URL, specification digests,
   changed files, verification results, and attestation.
8. Stream progress and failures back to the collaborative workspace.

Repositories must choose how specification source is owned. A JSON-authored
project can commit the published `spec.json` files directly. A project that
uses hand-authored `spec.ts` must define a lossless synchronization step. The
pipeline must fail if `spec.ts` and `spec.json` disagree; it must never silently
overwrite human-authored source.

Alchemy can provide one implementation of the preview deployment step, but the
pipeline contract should also allow other project-owned deployment providers.

Preview automation also needs operational limits:

- Build jobs must be durable and idempotent so a worker restart does not create
  duplicate pull requests or environments.
- Repository tokens and deployment credentials must be scoped to the selected
  repository and preview environment.
- Pull requests from untrusted forks must not receive deployment secrets.
- Preview deployments must have resource, time, network, and cost limits.
- A preview must be tied to the exact verified commit, not a moving branch.
- Updating a published revision must create an explicit new run and new
  evidence.
- Closing the pull request or reaching a time limit should remove the preview.
- The service must never merge the pull request or deploy to production without
  a separate human-approved action.

The pull request remains the review boundary. Automation can produce an
implementation and evidence, but people still decide whether the
specifications are complete, the generated design is maintainable, and the
preview behaves as intended.

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
expected-version checks and idempotency. Its Event Log
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
- Structured errors.
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
talk to any supported runtime. It should stay separate from runtime tracing and
should not turn Core into a network framework.
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

## Codemod-Powered Analysis And Upgrades

Specter already contains two Codemod packages that prove different uses:

- [`specter-json-specs`](./codemods/specter-json-specs/) performs the mechanical
  migration from direct TypeScript specification imports to generated
  `spec.json`.
- [`function-usage-detector`](./codemods/function-usage-detector/) performs
  workspace-wide semantic analysis and produces JSON and HTML reports without
  changing analyzed source files.

These should become the start of a maintained Specter migration and analysis
toolkit.

### Read-Only Project Analysis

Codemod's JSSG engine combines syntax-aware matching with
[workspace semantic analysis](https://docs.codemod.com/jssg/semantic-analysis)
for JavaScript and TypeScript. It can follow definitions, references, imports,
and re-exports across files. Specter can use that for checks that need more
context than text matching:

- Find `impl.ts` files that bypass their adjacent `spec.json`.
- Detect Slice implementations that import or call another Slice
  implementation.
- Detect `Effect.run*`, live Layer construction, ambient `fetch`,
  `process.env`, `Date.now`, `Math.random`, and direct Node built-in use inside
  Slice implementations.
- Compare explicit Effect service use with the services allowed by the Slice's
  execution policy. The TypeScript compiler remains responsible for inferred
  Effect requirements.
- Find old builders, deprecated APIs, and partially completed migrations.
- Produce an adoption inventory before changing a brownfield application.

Analysis packages should return no source edits. They should emit stable,
machine-readable findings with:

- A rule identifier and severity.
- Exact file and source location.
- Resolved definition and reference evidence where available.
- The policy or Specter version that produced the finding.
- Known blind spots and unresolved references.
- A stable summary suitable for CI and verification attestations.

The same analysis may also render a local HTML report for people. The JSON
report remains the canonical artifact.

Codemod does not replace the resolved module-graph checks described above. JSSG
is useful for symbol and call relationships, while a TypeScript resolver and
whole-project graph are better for transitive package rules, path aliases,
workspace packages, and unresolved dynamic imports. Both tools should emit the
same Specter violation format so CI and the dashboard can show one result.

Open-source JSSG semantic analysis currently covers JavaScript, TypeScript, and
Python. Go and Rust checks should use their language-native compiler and module
tools rather than make a paid semantic service part of Specter Core.

### Versioned Specter Migrations

Every breaking Specter release should include deterministic migrations for the
parts that can be changed safely:

- Package names, imports, builders, and runtime construction.
- `spec.ts` authoring API changes.
- Portable `spec.json` format upgrades.
- Configuration, scripts, and generated-file conventions.
- Adapter construction and renamed Effect services.
- Transport envelope and client API changes.

Each migration should be a small, exact `from -> to` package with positive,
negative, edge, and no-op fixtures. It should be idempotent and safe to run
again. Official packages can be distributed through the
[Codemod Registry](https://docs.codemod.com/platform/registry), with exact
versions pinned in automated runs.

A migration must not guess when a change needs domain or architecture judgment.
Ambiguous cases should remain unchanged and produce a finding or explicit
review marker. Event-history migrations, new business rules, Slice ownership
changes, and application partitioning still require a separately reviewed
plan.

After applying a migration, its workflow should run:

1. portable specification export and canonical digest checks;
2. Specter conformance and exact Scenarios;
3. dependency and capability checks;
4. typecheck, tests, and build; and
5. a second dry run showing that no further edits are needed.

The resulting report should record the Codemod package and version, input
commit, changed files, unresolved findings, and verification results. That
report can become an input to the verification attestation.

### Workflows, Pull Requests, And Large Repositories

[Codemod Workflows](https://docs.codemod.com/workflows/introduction) can order
analysis, deterministic transforms, validation commands, and manual approval
gates. The local open-source workflow should be the portable foundation.
Optional Codemod Campaigns can add hosted execution, resumable tasks, sharding,
and pull requests across many repositories.

For Specter's specification-to-preview pipeline, a Codemod workflow can:

1. inventory the target repository;
2. apply required Specter upgrades;
3. stop for approval when findings need judgment;
4. hand the narrowed remainder to the coding agent;
5. verify the result; and
6. contribute its report to the draft pull request.

Large migrations can be split by feature directory or `CODEOWNERS` so each
team receives a reviewable pull request instead of one repository-wide change.
Codemod's
[Campaign model](https://docs.codemod.com/platform/campaigns) can provide this
when a team chooses the hosted product, but Specter should not require it.

All Codemod execution should follow the same safety rules as coding-agent
execution:

- Run against an isolated branch or worktree.
- Pin the CLI and package versions in CI.
- Start with analysis or dry run before applying changes.
- Limit file scope explicitly.
- Review the resulting patch before commit.
- Run transforms without network or secrets unless the workflow declares and
  is approved for them.
- Treat optional AI steps and external package validation as source-sharing
  boundaries that require explicit approval.

Codemod is not the verifier and it is not a security sandbox. It reduces
repeatable migration and analysis work; Specter still decides whether the
result conforms to the specification and runtime contracts.

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
