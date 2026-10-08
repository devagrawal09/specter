# agent-runtime findings log

Specter rough edges and decisions discovered while building `apps/agent-runtime`. One entry per finding; newest last.

## 2026-10-08 — scaffold (M1 task 1-2)

- **`@ocpp/schema` must be linked, not `file:`-installed.** Its `package.json` uses `catalog:` dependencies, which pnpm cannot resolve from a `file:` copy. `link:../../../opencode/packages/schema` works; its `exports` map points at `src/*.ts` so no tsconfig `paths` were needed.
- **Effect version skew is a type-level problem, not a runtime one.** `@ocpp/schema` resolves `effect@4.0.0-rc.112` from OC++'s `node_modules`; Specter is on `4.0.1`, which renamed `Schema.isStartsWith` -> `isStartingWith`. OC++'s schemas do not compile against 4.0.1, so `src/events.ts` casts before `Schema.toStandardSchemaV1`. Runtime decode/validation works (smoke-tested). Cost: `sessionEventDefinitions` loses typed payloads until the versions align (M2 prerequisite: bump OC++ to 4.0.1 or vendor the schema build).
- **49 durable session events, not ~45.** `SessionEvent.DurableDefinitions` has 48 public plus the internal `UsageRecorded`.
- **Specter exporter fails on zero specs.** `spec export` errors with "No spec.ts files matched" for an app with no slices yet; the app's `spec:build` guards with `ls`. Candidate Specter fix: exit 0 with a notice.
- **Base tsconfig pulls `packages/core/src` via `paths`, so the app needs the DOM lib** (`TextEncoder`, `AbortSignal`). A UI-less app should not need DOM; candidate Specter fix: core should type against `lib.es2022` + node types only.
- **`paths` overrides rather than merges**, so every app repeats the `@specter-ts/core` entries.

## 2026-10-08 — first specs (M1 task 3-4; 33 scenarios across 3 slices)

- **Dotted event types are rejected by the normative spec format** (`packages/spec/src/validation.ts:165`, `specification/schemas/slice.schema.json`). Decision: keep Specter kebab-only; the app maps `.` -> `-` in `src/events.ts` and the M4 bridge maps back.
- **No no-op scenario outcome.** A scenario must `expect` at least one Event or `reject` (`validation.ts:137`, schema `expect minItems: 1`). OC++'s idempotent admission ("first admission wins; retried payload ignored") and post-delivery retry reconciliation are therefore inexpressible, even though Specter's runtime has first-write-wins idempotency as the default mode (#48). Candidate Specter change: allow `expect: []` without `reject` meaning "accepted, no new facts".
- **The spec builder has no `.inputSchema` / `.outputSchema`**; only `.description().scenarios()`. Input/output shapes are implied by scenario payloads. The runtime builder has them (runtime.md "Schema modes"); the authoring package does not.
- **`event()` payloads are untyped `JsonValue`** and are not checked against the app's event definitions at export time. "Same payloads as OC++" is enforced only at runtime, not in `spec.ts`. Candidate Specter change: `spec export` validates `given`/`expect` payloads against the registered definitions when available.
- **Cross-aggregate reads in `given`.** The enqueue-input cross-session rejection scenario puts another session's events in `given`, assuming the Command can see them. This is the cross-aggregate read the plan flagged; it will be settled when the impl is written.
- **Exact rejection reasons are invented.** session.md names error types (`LifecycleConflict`, `SessionNotFoundError`) but no messages; the specs use short sentences. Align with OC++'s error schemas before M4.
- **No-op outcome — decided 2026-10-08:** keep Specter's rule. Idempotent retry is a rejection in the app (exact reason), translated back to OC++'s silent success at the M4 facade. Revisit if a second app needs "accepted, no facts".

## 2026-10-08 — first implementation (M1; 3 slices, 36 scenarios)

- **Effect skew breaks runtime decode, not only types.** Mixing `@ocpp/schema` (effect rc.112) with Specter (4.0.1) throws `s.startsWith is not a function` for every payload. Tests alias `effect` to rc.112 in `vitest.config.ts`; Specter core runs fine on rc.112. Must be resolved before M2 (align versions), and the earlier "type-level only" note was wrong.
- **Spec payloads are not validated against event schemas at `spec:build`.** Both spec writers used `inb_*` inbox IDs and `{type:'local'}` locations; `@ocpp/schema` requires `msg_*` and `{directory}`. Nothing caught it until the conformance check at test time. Strong case for the exporter validating `given`/`expect` payloads when definitions are available.
- **Conformance `extra-apply-handler` forbids apply handlers for events that never appear in a Given.** Reasonable as a lint, but it forced dropping the `session-inbox-cancelled` apply until a duplicate-cancel scenario was added. Rule should probably be a warning, or apply handlers should count as covered when the slice emits that event.
- **`eventsFor(slice, catalog)` is required for per-slice tests**; a whole-app catalog fails conformance with `event-without-scenario` for every unmentioned event. Fine, but undocumented for multi-slice apps with large catalogs.
- **Query builder: `.outputSchema<T>()` must precede `.store`**, and omitting it yields a type error that does not say so.
- **Slice state is projected from the global log**, so per-session state is keyed manually by session ID inside each slice. Cross-aggregate reads in a Command therefore work (the cross-session inbox-ID rejection scenario passes) — the plan's open question is answered: yes, trivially, because there is no aggregate boundary in slice projections.
- **Harness throws on `[]` from a Command** ("Command emitted no events"), consistent with the spec-format rule; the app models idempotent retry as a rejection (decided).
- **Correction: the no-op restriction applies to Commands only.** Reaction scenarios accept `expect: []` ("requests nothing"), as in `apps/reference`'s cheer reaction. So "repeated wakes coalesce" is directly expressible as a Reaction scenario; only Command-level idempotent success remains inexpressible (modelled as rejection, decided).
