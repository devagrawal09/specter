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
