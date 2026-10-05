# Reaction Plugin context

## Goal

Reaction Plugins are blind: `CommandDispatch` resolves to `void`, Plugins
cannot run Queries, and Plugin service requirements are typed `unknown`. A
long-running outboxed Plugin had to read the Event Log directly and failed at
runtime when a service was missing. Give Plugins a typed same-app context and
make the compiler check their services.

## Scope

- In: `ReactionPluginContext` (`{ command, query }`) passed to Plugin factories;
  `CommandDispatch` resolving to `CommandReceipt`; `QueryDispatch`; Plugin
  requirement type `R` on `ReactionPlugin`, `ReactionSlice`, and the Reaction
  builder; `SpecterPluginRequirements` in `SpecterRuntimeRequirements`;
  runtime rejection of Queries from a direct Plugin inside its Reaction
  transaction; core type tests, runtime tests, and docs.
- Out: making nested Query catch-up inside a Reaction transaction safe in
  adapters; returning nested Reaction completion from Plugin `command`; typing
  `command` envelopes per app; Plugin requirements for configs widened to
  `SpecterAppConfig`.
- Dependencies (separate workspaces, not specified here): `packages/reaction-outbox`
  forwards the context and `R`; apps `narayan-ai`, `personal-mail`,
  `threadplane-reference`, and `specter-code` adopt the context parameter; the
  shared Specter skill and repository docs describe the API.

## Required behavior

- A Plugin factory receives one frozen context with `command` and `query`.
- `command` resolves to `{ events, version, duplicate }` for fresh and duplicate
  idempotent commits and never awaits nested Reactions.
- `query(querySlice, input)` dispatches by the Query Slice name, typed by its
  input and decoded output.
- `query` fails with `SpecterInfrastructureError` while a direct Plugin
  executes inside its Reaction's Slice Store transaction; the Reaction rolls
  back and retries. It succeeds from Plugin initialization and from fibers
  outside the transaction, such as the outbox worker.
- `.plugin(...)` infers `R`; an annotated `ReactionPlugin<TOutput>` defaults
  `R` to `never`. `Scope` is always available and excluded from app
  requirements.
- `createSpecterApp` and `createSpecterAppLayer` require every literal Plugin
  service in their dependency Layer type.

## Tasks

- [x] Add `CommandReceipt`, `QueryDispatch`, `ReactionPluginContext`, and
      `ReactionPluginRequirements`; thread `R` through Reaction builder types.
- [x] Pass the context from the runtime and enforce the direct-Plugin Query
      guard.
- [x] Add Plugin requirements to `SpecterRuntimeRequirements`.
- [x] Add type tests in `builders.type-test.ts` and `runtime.type-test.ts`.
- [x] Add runtime tests for receipts, typed Queries, and the Query guard.
- [x] Update `docs/architecture/plugins.md`, core runtime API reference, and
      the Specter skill.
- [ ] Delete this OpenSpec change directory before merge.

## Validation

- `pnpm --filter @specter-ts/core typecheck`
- `pnpm --filter @specter-ts/core exec vitest run src/effect/runtime.test.ts`
- `pnpm --filter @specter-ts/reaction-outbox test`
- `node scripts/validate-openspec.mjs`
