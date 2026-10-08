# agent-runtime findings log

Specter rough edges and decisions discovered while building `apps/agent-runtime`. One entry per finding; newest last.

## 2026-10-08 — scaffold (M1 task 1-2)

- **`@ocpp/schema` must be linked, not `file:`-installed.** Its `package.json` uses `catalog:` dependencies, which pnpm cannot resolve from a `file:` copy. `link:../../../opencode/packages/schema` works; its `exports` map points at `src/*.ts` so no tsconfig `paths` were needed.
- **Effect version skew is a type-level problem, not a runtime one.** `@ocpp/schema` resolves `effect@4.0.0-rc.112` from OC++'s `node_modules`; Specter is on `4.0.1`, which renamed `Schema.isStartsWith` -> `isStartingWith`. OC++'s schemas do not compile against 4.0.1, so `src/events.ts` casts before `Schema.toStandardSchemaV1`. Runtime decode/validation works (smoke-tested). Cost: `sessionEventDefinitions` loses typed payloads until the versions align (M2 prerequisite: bump OC++ to 4.0.1 or vendor the schema build).
- **49 durable session events, not ~45.** `SessionEvent.DurableDefinitions` has 48 public plus the internal `UsageRecorded`.
- **Specter exporter fails on zero specs.** `spec export` errors with "No spec.ts files matched" for an app with no slices yet; the app's `spec:build` guards with `ls`. Candidate Specter fix: exit 0 with a notice.
- **Base tsconfig pulls `packages/core/src` via `paths`, so the app needs the DOM lib** (`TextEncoder`, `AbortSignal`). A UI-less app should not need DOM; candidate Specter fix: core should type against `lib.es2022` + node types only.
- **`paths` overrides rather than merges**, so every app repeats the `@specter-ts/core` entries.
