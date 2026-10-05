# Cached app validation

## Goal

Apps that open many small Specter apps from the same `events` and `slices`
objects (one app per session, often concurrently) repeat the same conformance
pass and lookup-map construction for every app. Validate each config once,
reuse the result for every Event Log and Layer, and let callers validate at
startup explicitly. Also make `createSpecterApp` reject on configuration
errors instead of deferring them to the first operation.

## Scope

- In: `packages/core` runtime construction (`createSpecterApp`,
  `createSpecterPromiseApp`, `createSpecterAppLayer`, `makeSpecterRuntime`),
  a new prepared-app API, tests, a construction micro-bench script, and the
  runtime docs under `docs/`.
- Out: changing conformance rules or diagnostics; content-digest caching of
  rebuilt config objects; caching anything that depends on an Event Log, Store,
  or scheduler; changes to sibling apps or adapter packages. The lasting docs
  for this package live in the repository `docs/` folder and are updated here.

## Required behavior

- Per-config work (conformance plus derived lookup structures) runs at most
  once per `events`/`slices` object pair while that pair is reachable.
- Concurrent first use of one config shares one in-flight validation.
- Every caller of an invalid config receives `SpecterConformanceError`; a
  failed validation is not cached for later callers.
- `prepareSpecterApp(config)` (Promise) and `prepareSpecterRuntime(config)`
  (Effect) return a `PreparedSpecterApp` accepted wherever a config is accepted.
- `createSpecterApp` rejects with `SpecterConformanceError` for an invalid
  config. Store resolution, scheduler binding, and Reaction and eager-Slice
  catch-up stay per app; `createSpecterApp` awaits them, so their failures
  also reject construction (as the API reference already documented).
- `createSpecterPromiseApp` stays synchronous; its startup failures reject
  every operation without an unhandled rejection.

## Tasks

- [x] Split per-config plan from per-log runtime setup in `src/effect/runtime.ts`.
- [x] Add identity-keyed, in-flight-deduplicated plan cache.
- [x] Add `prepareSpecterApp` / `prepareSpecterRuntime` and `PreparedSpecterApp`.
- [x] Make `createSpecterApp` await validation and per-log startup; stop
      `createSpecterPromiseApp` startup failures from becoming unhandled
      rejections.
- [x] Tests: cache hit, concurrent first use, invalid config rejection, prepared
      path for Promise and Effect APIs.
- [x] Micro-bench script timing 500 `createSpecterApp` calls with one config.
- [x] Update `docs/architecture/runtime.md` and
      `docs/api-reference/core-runtime.md`.
- [ ] Delete this OpenSpec change directory before merge.

## Validation

- `pnpm --filter @specter-ts/core test`
- `pnpm --filter @specter-ts/core typecheck`
- `pnpm check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- `node scripts/validate-openspec.mjs`
