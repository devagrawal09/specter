# Multi-App Specter Build Evaluation

Date: 2026-07-16

> [!IMPORTANT]
> **Historical baseline; superseded by the Specter 0.3 overhaul.** This report
> records what three applications experienced at commit `69ddd0e9` before the
> envelope runtime, project-owned transport, maintained adapters, generators,
> and operational packages were implemented. API names such as
> `defineSpecterClient` and present-tense capability gaps below describe that
> evaluated commit, not the current 0.3 design. The matrix below is the current
> resolution record; the original evidence remains unchanged for traceability.

## Executive assessment

Three independent agents built three non-trivial workflow applications from the same Specter commit in isolated Git worktrees:

- emergency-department operations,
- cold-chain freight control,
- property-insurance claims adjudication.

Together they produced 30 vertical slices and 32 Event Definitions covering guarded commands, operational queries, reactions that dispatch commands, typed browser/server boundaries, live-query behavior, replay/catch-up, conformance failures, and reaction failures. None of the agents modified Specter core.

Specter's strongest quality is the executable domain contract. Exact scenarios, Given/apply parity, event authorization, and construction-time conformance repeatedly caught modeling and integration mistakes before they reached browser tests. The model held up across healthcare, logistics, and insurance without forcing the domains into a shared application architecture.

The largest delivery cost is the infrastructure and projection work surrounding the domain model. Every credible app needed custom Event Log, Slice Store, scheduler, HTTP routing, reset, and browser-test seams. Live subscription is present in the runtime but absent from `defineSpecterClient`, so two apps refreshed queries after commands and the ED app built a custom SSE bridge. The same focused-test event-catalog surprise occurred independently in all three builds.

Overall verdict: Specter is already effective for explicit, auditable workflows, but the next-build experience would improve materially with first-party adapters, typed subscription transport, conformance-aware generators, and clearer focused-test/subscription semantics.

## Specter 0.3 recommendation resolution

| # | Historical recommendation | Specter 0.3 resolution |
|---:|---|---|
| 1 | Typed subscription transport | Resolved with the generated project-owned typed envelope transport: HTTP for Commands/Queries and abortable, reconnecting, latest-state SSE for subscriptions. Core remains transport-agnostic. |
| 2 | Production adapters and scheduler presets | Resolved by maintained `@specter-ts/memory`, `@specter-ts/sqlite`, `@specter-ts/postgres`, and `@specter-ts/reaction-outbox` packages. PostgreSQL CI exercises real advisory-lock serialization, rollback, JSONB persistence, atomic outbox claims, retry/dead-letter flow, and replay against a service database. |
| 3 | Separate committed Command outcome from Reaction failure | Resolved by `CommandExecution`: the outer Promise settles after durable Event commit and contains a separate `reactions: Promise<void>` backed by aggregate failure semantics and durable retry/dead-letter operations. |
| 4 | Focused-test Event catalog ergonomics | Resolved by `eventsFor(slice, catalog)` and direct conformance remediation hints. |
| 5 | Vertical-Slice and persistent-harness generation | Resolved by `create-specter generate slice` and the executable `generate persistent-harness` restart/replay/reset/failure-recovery suite. |
| 6 | Typed projection scaffolding | Resolved by the Slice generator's independent Drizzle projection, idempotent apply stub, schema export, and migration checklist. |
| 7 | First-party HTTP/browser template | Resolved in the starter with typed Command/Query/SSE routes, JSON/error boundaries, fixed strict ports, separated Vitest/Playwright globs, browser preflight, and an executable Playwright workflow. |
| 8 | Explicit subscription start/context semantics | Resolved in [runtime boundary guidance](../guides/runtime-boundaries.md) and the server transport, which scopes iterator activation, iteration, cancellation, and cleanup. |
| 9 | Conformance remediation and propagation tooling | Resolved by position/path-aware conformance guidance plus `analyzeEventPropagation(...)` and `formatEventPropagation(...)` in `@specter-ts/core/testing`. |
| 10 | Event/Reaction/projection observability | Resolved by `@specter-ts/observability`, including a framework-agnostic development panel for persisted Events, cursor lag, subscriptions, Reaction runs, replay/catch-up, and outbox attempts. |
| 11 | Idempotency and concurrency primitives | Resolved by `idempotencyKey`, durable commit receipts, `expectedVersion`, and serialized/optimistic Event Log adapter behavior. |
| 12 | Prominent schema-mode tradeoffs | Resolved in [runtime boundary guidance](../guides/runtime-boundaries.md#schema-modes), the canonical Specter agent skill, and untrusted-boundary starter schemas. |

## Experimental setup

All worktrees started at commit `69ddd0e9a5431bc250c318a569f0e55c279e0f36` (`feat: complete Specter API migration`). Each app used its own branch and fixed strict port.

| App | Branch and commit | Domain scope | Port |
|---|---|---|---|
| ED Ops | `eval/specter-ed-ops` at `928aa8d05f26e46a117f52bcc9f995ec40485469` | registration, triage/reassessment, beds, diagnostics, critical escalation, readiness, discharge | `41801` |
| Cold Chain | `eval/specter-cold-chain` at `8f3af8a795063407c86dbed5104cbb19b7c87259` | shipment creation/dispatch, checkpoints, telemetry excursion, quality hold, investigation, disposition, delivery | `41802` |
| Claims | `eval/specter-claims` at `23589a6343d081820005a0e4d3e1fc1b57340842` | FNOL, evidence, coverage/reserve assessment, fraud referral, adjudication, settlement, payment, appeal | `41803` |

The agents were required to keep a chronological build log, run Specter scenario tests and browser tests iteratively, and report failures, diagnoses, workarounds, and framework recommendations. The coordinating agent then inspected API usage and independently reran the app test suites, typechecks, and all browser workflows.

## Results at a glance

| App | Slices | Events | Persistence approach | Vitest/Specter | Playwright | Typecheck/build |
|---|---:|---:|---|---|---|---|
| ED Ops | 8 | 10 | SQLite/libSQL with persistent restart catch-up | 33/33 passed | 2/2 passed | passed |
| Cold Chain | 10 | 11 | in-memory log with store reset/reconstruction catch-up | 29/29 passed | 2/2 passed | passed |
| Claims | 12 | 11 | app-local in-memory adapters | 25/25 passed | 2/2 passed | passed |
| **Total** | **30** | **32** | — | **87/87 passed** | **6/6 passed** | **all passed** |

The ED branch also ran the selected repository baseline after a full offline dependency link: root check and lint passed with pre-existing warnings/information, typecheck passed, 581/581 tests passed, and build passed. The cold-chain branch saw one unrelated Threadplane timeout under parallel load; its focused rerun passed 3/3, and the ED branch's later 581-test baseline was fully green.

## Application outcomes

### Emergency-department operations

The ED app is the deepest persistence and live-subscription experiment. Six command slices model the patient journey, one reaction turns critical results into a guarded alert command, and one query projects all ten events into a live operational dashboard. SQLite backs both the event log and private slice projections. The browser receives actual Specter query-subscription invalidations through a custom SSE route.

The two browser workflows covered:

1. ambulance arrival through triage, bed assignment, diagnostics, critical result, reaction-created alert, and live dashboard update;
2. walk-in registration through an early-discharge rejection, readiness, successful discharge, and live census/card updates.

This build proved persistent restart catch-up, including an event appended while projections were offline. It also uncovered the most subtle runtime integration issue: initial subscription work starts when `[Symbol.asyncIterator]()` is called. Because the SQLite adapter uses async-local context, scoping only `iterator.next()` was too late; the entire iterator creation/iteration/cleanup lifecycle had to be wrapped.

### Cold-chain freight control

The cold-chain app used eight commands, one reaction, and one query to model a shipment state machine. Out-of-range telemetry advances the reaction, which dispatches `openExcursionIncident`; that command emits both the incident and quality-hold facts. Investigation and disposition commands enforce acknowledgment/corrective-action gates before release or rejection.

The browser workflows covered:

1. registration, dispatch, checkpoint, out-of-range telemetry, automatic incident/hold, live operational status, search, and filters;
2. two visible decision-gate failures, acknowledgment, corrective action, release, and proof of delivery.

The app rebuilds all private stores from a retained in-memory event log, proving catch-up semantics without claiming OS-process durability. The typed client caught unsafe `FormData` spreading at typecheck time, requiring explicit field mappings.

### Property-insurance claims

The claims app used nine commands, two queries, and one reaction. A high fraud score produces a typed command envelope that opens a special investigation. Approval is blocked until clearance; settlement and payment have amount/status guards; denial can be appealed into a reopened review queue.

The browser workflows covered:

1. high-risk FNOL, evidence, assessment, automatic SIU referral, guarded approval failure, clearance, approval, authorization, and payment;
2. low-risk claim denial, appeal, and filtered work-queue status.

The app intentionally used small in-memory adapters so the agent could emphasize domain breadth. That made durable restart/correct transaction behavior an explicit unmet item rather than an implied success. Static-only output typing also demonstrated its tradeoff: an omitted scenario field was caught by scenario execution rather than construction-time schema validation.

## Specter API coverage

Each app exercised every public runtime value/API category relevant to application authors:

- `createEventDefinition` with Standard Schema-compatible Zod payload schemas;
- exact `event(type, payload)` scenario literals;
- `createCommandSlice`, `createQuerySlice`, and `createReactionSlice`;
- runtime Standard Schemas and static-only schema overloads;
- private stores and apply handlers;
- `createSpecterApp` and construction conformance;
- `EventLogAdapter`, `SliceStoreAdapter`, and `ReactionScheduler`;
- `defineSpecterClient` at the UI/server boundary;
- server-side query `subscribe` as an `AsyncIterable`;
- `testSliceImplementation` and `testSliceImplementations`;
- direct `replay` usage;
- accepted/rejected command, query, and reaction scenarios;
- reaction-to-command `CommandEnvelope` dispatch;
- focused `SpecterConformanceError` and `ReactionRunFailure` behavior.

Type-only exports were exercised through app config inference, adapter declarations, command/query references, Event Draft/Persisted Event handling, reaction plugin typing, and completed slice builders rather than artificial runtime calls.

The browser client itself does not expose subscriptions. ED Ops added SSE to exercise actual browser streaming. Cold Chain and Claims tested the runtime `AsyncIterable` directly, then refreshed typed queries after browser commands. This distinction is a framework capability gap, not missing runtime test coverage.

## What went well across the builds

### Executable scenarios served as useful design artifacts

The agents had to decide exact IDs, timestamps, payloads, guards, and emitted facts before runtime wiring. Reviewers can understand release gates, discharge gates, and SIU clearance behavior by reading scenarios without reverse-engineering handlers.

### Conformance failures were precise and actionable

Event/spec/apply drift failed early with localized diagnostics. All three agents resolved their first focused-test failure without bypassing validation. Unauthorized command-event emission and exact output checking prevented scenarios from becoming aspirational documentation.

### Private state kept decision ownership clear

Commands did not depend on operational query projections. Each decision slice reconstructed only the facts needed for its guards. This created duplication, but it also made hidden dependencies difficult to introduce.

### Reactions composed through normal command boundaries

All three apps used a reaction output as a `CommandEnvelope`. The generated command still enforced normal business guards, and the initiating request waited for the immediate scheduler to drain. The pattern was concise once the event vocabulary existed.

### Type inference reached the browser boundary

`defineSpecterClient<typeof config>` made command/query names and inputs discoverable and typechecked. In the cold-chain build it caught a real unsafe form-mapping assumption before browser execution.

### Replay, catch-up, and subscription invalidation were deterministic

The apps rebuilt query projections from ordered event history, subscriptions emitted an initial value and an invalidated value, and the ED app proved disk-backed catch-up after reconstruction. Domain IDs and timestamps stayed in inputs rather than handler-generated state.

## Repeated issues and workarounds

### 1. Focused scenario tests require a curated Event catalog — 3/3 apps

All three agents initially passed the full app Event catalog to `testSliceImplementation`. Conformance then correctly reported every unrelated Event as lacking scenario coverage. Each workaround was the same: provide the focused slice's minimal catalog to the singular helper and the full catalog to `testSliceImplementations`.

The behavior is defensible but not discoverable. The helper should infer/filter relevant Event Definitions or emit a specific remediation hint explaining the whole-app versus focused-slice distinction.

### 2. Runtime subscription is absent from the typed browser client — 3/3 apps

`createSpecterApp` exposes `app.subscribe.<query>()`; `defineSpecterClient` exposes fetch-based command/query calls only. ED Ops wrote an SSE bridge and `EventSource` client. Cold Chain and Claims refreshed queries after commands while directly testing server subscription behavior.

This is the largest end-to-end capability gap because real operational UIs commonly need cross-tab/server-originated changes, reconnect behavior, cancellation, and backpressure.

### 3. Real applications must build substantial infrastructure — 3/3 apps

Each app owned adapters, scheduler behavior, HTTP routing, error mapping, database/test setup, and reset/catch-up seams. The interfaces are flexible, but greenfield teams can easily write non-transactional memory adapters or schedulers with unsafe failure/idleness behavior.

ED Ops reused the repository's SQLite patterns and paid more setup cost; Cold Chain and Claims used transparent in-memory implementations and had to qualify durability and transaction claims.

### 4. Private projections and exact scenarios create repetition — 3/3 apps

The same facts appeared in multiple decision projections and query scenarios. This is partly the intended price of independent vertical slices, but broad payload evolution is expensive and SQL-backed slices add repetitive table/cursor/apply plumbing.

The correct improvement is code generation or typed scaffolding that preserves separate state ownership, not shared mutable projections or cross-slice imports.

### 5. Browser/toolchain setup consumed avoidable iterations — 3/3 apps

Playwright 1.60 expected a browser/headless-shell revision not consistently present in the shared cache. ED and Claims added executable-path overrides; Cold Chain installed the pinned browser. Cold Chain also needed an explicit `testMatch` for `*.e2e.ts`. Generated apps should include a working Playwright convention and browser preflight.

### 6. Reaction failure semantics need operational clarification — observed or discussed in 3/3 apps

The initiating command's facts can already be durable when a reaction fails and `ReactionRunFailure` rejects the request. The public error preserves slice/cause detail, but production apps need a clear committed-command result, durable reaction attempts, retries/backoff, idempotency, and dead-letter recovery.

## Unique findings

- **Subscription activation/context boundary (ED):** `[Symbol.asyncIterator]()` performs the initial query. Request-scoped adapter context must therefore surround iterator construction, not just `next()`.
- **Real persistent harness cost (ED):** SQLite/libSQL, migrations, async-local context, slice tables, and SSE made the production-shaped experiment substantially more involved than the memory-backed apps.
- **Static-only schema tradeoff (Claims):** static typing did not validate an omitted output field at construction; exact scenario execution caught it later.
- **Typed form mapping (Cold Chain):** generic `FormData` records could not prove required client fields, prompting safer explicit mapping.
- **Solid 2 integration (ED and Claims):** two-callback effects, JSX/runtime configuration, and `classList` differences caused non-Specter iterations. Claims still emits documented non-failing strict-untracked development warnings.
- **Repository parallel-test sensitivity (Cold Chain):** one Threadplane timeout disappeared on focused rerun; the later ED full baseline passed, so it was not attributed to either app.

## Prioritized Specter improvements

### P0 — close end-to-end runtime gaps

1. **Add typed subscription transport.** Extend the client with `client.subscribe.<query>()` over supported SSE/WebSocket transports, including abort, reconnect, serialization, and backpressure semantics.
2. **Ship production-grade adapters and scheduler presets.** Provide maintained SQLite and Postgres Event Log/Slice Store packages, a deterministic memory test adapter, an immediate test scheduler, and a durable outbox scheduler.
3. **Separate committed command outcome from reaction-drain failure.** Make partial success explicit and provide durable retry/dead-letter operations for reactions.

### P1 — remove repeated authoring friction

4. **Improve focused-test Event catalog ergonomics.** Infer relevant definitions, expose an `eventsFor(slice)` helper, or add a focused conformance mode with direct remediation guidance.
5. **Generate vertical slices and persistent harnesses.** From a scenario, create `spec.ts`, `impl.ts`, private state/apply stubs, registry wiring, focused tests, database exports, and migration/test scaffolding.
6. **Add typed projection scaffolding.** Generate repeated event-to-private-state handlers while materializing independent stores for each slice.
7. **Provide a first-party HTTP/browser template.** Include typed command/query routes, subscription transport, boundary linting, error mapping, fixed-port Vite, separated Vitest/Playwright globs, and browser preflight.

### P2 — improve diagnosis and advanced workflow safety

8. **Make subscription start semantics explicit.** Document or expose a named start boundary and add a runtime context/unit-of-work hook so HTTP/SSE adapters do not guess async-local scope lifetimes.
9. **Add conformance remediation hints and propagation tooling.** Diagnostics should name scenarios/apply handlers to change and show where an Event payload change propagates.
10. **Add event/reaction/projection observability.** A development panel should show persisted Events, slice cursor lag, subscription invalidations, reaction passes/failures, replay, and catch-up.
11. **Add idempotency and concurrency primitives.** Payments, deliveries, bed assignment, and duplicate submissions need supported optimistic concurrency/idempotency patterns rather than application conventions alone.
12. **Make schema-mode tradeoffs prominent.** Documentation and possibly API naming should make runtime-validation versus static-only typing unmistakable at untrusted boundaries.

## Limitations of the evaluation

- These are workflow-rich evaluation applications, not production deployments. Authentication, authorization, multi-tenant isolation, regulatory controls, complete concurrency policy, and operational hardening were outside scope.
- Cold Chain and Claims use in-memory adapters. Their reports explicitly do not claim crash-safe persistence or production transaction isolation.
- Only ED Ops implements browser push from the runtime subscription; the other two demonstrate runtime invalidation in integration tests and typed browser refresh after commands.
- The immediate in-process schedulers prove reaction execution and idleness, not crash-safe delivery.
- Playwright executable overrides are environment-specific and intentionally documented rather than treated as Specter defects.
