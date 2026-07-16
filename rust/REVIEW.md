# Rust 0.3 Port Review

This review compares the Rust experiment with the TypeScript Specter 0.3
runtime and adapter contracts. The runtime-level concurrent ticket divergence
found during review was fixed: requests now coalesce to one scheduler idle
point, and `runtime_03.rs` covers shared failure delivery.

## P1: Runtime gaps

1. **Slice State and delivery metadata are process-local.** Slice state/cursors
   live inside each completed Slice and Reaction delivery attempts live inside
   the app. Rebuilding over a durable Event Log replays successful effects and
   resets delivery attempt metadata. A pluggable Slice Store plus durable
   scheduler/outbox is required before restart semantics match 0.3.
2. **Scheduler launch is tied to Tokio.** A committed Command uses
   `tokio::spawn` to start its Reaction pass. Polling the app under a different
   executor can panic after the durable commit instead of returning a failed
   Reaction ticket. Scheduler/spawner injection should own this boundary.
3. **Subscription invalidation is global.** Every nonduplicate commit wakes
   every Query subscription. The runtime should intersect committed Event types
   with each Query's apply catalog. The current subscription also erases the
   `QueryRef` output type and supports one outstanding mutable `next` call.
4. **Typed references are forgeable.** `CommandRef::new` and `QueryRef::new`
   accept arbitrary operation names and type parameters. References should be
   derived from completed, registered Slices rather than manually duplicating
   the spec name.
5. **Reaction plugins can return only one follow-up Command.** Specter 0.3
   plugins receive reusable dispatch and can produce several deterministically
   suffixed deliveries. The Rust executor exposes only
   `Option<CommandEnvelope>`.
6. **Errors are not transport-safe yet.** Variants do not expose stable wire
   codes or an infrastructure redaction boundary, and aggregate Reaction
   failures retain Slice names but discard individual causes.

## P1: App findings

1. **Batch-sensitive Reactions can lose work.** Incident notification state
   keeps one incident ID, Todo examines only the final completion count, and
   Deploy selects one element from an unordered `HashSet`. A catch-up batch can
   overwrite, skip, or reorder effects before the cursor advances through the
   whole batch.
2. **Create Commands do not enforce domain identity uniqueness.** Repeating a
   wallet, Todo, deployment, incident, receipt, or reservation identifier under
   a different request idempotency key can append duplicate business Events.
   The wallet example is destructive because a second `wallet-opened` resets
   its projections to zero.
3. **The apps prove only in-process durability.** Registries use the default
   in-memory Event Log and built-in scheduler. There is no restart/replay or
   durable Reaction recovery harness.
4. **Scenario verification stops before delivery.** Reaction Scenarios verify
   handler effects, not executor invocation, delivery context, retry identity,
   or follow-up Command idempotency. Those behaviors need focused integration
   tests.
5. **The layout is conceptually, not literally, identical to TypeScript.** Rust
   uses snake-case module directories, `mod.rs`, and `scenarios.rs`; TypeScript
   uses kebab-case directories and `scenarios.test.ts`. The feature, Slice,
   `spec`/`impl`, Event catalog, registry, and scenario boundaries do align.

## P2

- The Event Log guard contract needs explicit commit/rollback lifecycle rules
  before SQL adapters implement it.
- `SliceCaughtUp` observation exists but is not emitted, and observation/error
  coverage is thinner than TypeScript 0.3.
- `CommandScenario::accepted` rejects an empty outcome with a runtime assertion
  rather than a non-empty type.
- Testing helpers do not yet include focused Slice tests, replay helpers,
  `events_for`, or Event propagation analysis.
- Reaction delivery time is a Unix millisecond integer rather than the 0.3 ISO
  `scheduledAt` wire shape.
