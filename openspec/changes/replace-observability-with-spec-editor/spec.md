# Replace custom observability with the visual spec editor

## Goal

Replace Specter's custom collector, protocol, and dashboard with standard Effect tracing and a reusable local editor for committed portable Slice specifications. This belongs at repository scope because it changes shared runtime APIs, publishable packages, the Go runtime, Worklog authoring, Reference wiring, workspace release scripts, and repository documentation together.

## Scope

- In: new `@specter-ts/spec-editor`; Worklog JSON-authoring pilot; native Effect spans in core; removal of `@specter-ts/observability`, `@specter-ts/protocol`, TypeScript observer APIs, Go observation delivery, and their active docs and workspace wiring.
- Affected owners: repository root; `packages/spec-editor`; `packages/spec`; `packages/core`; `packages/observability`; `packages/protocol`; `apps/worklog`; `apps/reference`; `runtimes/go`.
- Out: migrating non-Worklog apps away from `spec.ts`; an embedded trace dashboard or trace links; payload capture; a default OTel exporter; replacement Go tracing; compatibility wrappers.

## Required behavior

- A local CLI serves a three-column browser editor on strict `127.0.0.1:41739`, discovers `src/features/**/spec.json`, validates all edits through `@specter-ts/spec`, and safely creates, updates, watches, and removes only specification files.
- Files with adjacent `spec.ts` are read-only. Worklog's 17 specifications become committed JSON sources and no longer run the exporter.
- TypeScript Command, Query, Reaction, and Slice catch-up operations emit metadata-only native Effect spans containing the Slice name, kind, specification digest, outcome, and relevant Event Log metadata. Applications own OTel export.
- Custom observation IDs, callbacks, protocol delivery, collector routes, storage, dashboard, CLI, TypeScript packages, and Go protocol/producer code are removed.
- Current public docs describe the editor, JSON pilot boundary, native tracing, and removed APIs without claiming Go tracing exists.

## Tasks

- [ ] `packages/spec-editor`: implement the CLI, local server API, filesystem containment/revision/watch behavior, three-column Solid UI, CodeMirror JSON fields, and focused tests.
- [ ] `apps/worklog` and repository root: export and commit all 17 JSON specifications, remove their TypeScript sources/export steps, and selectively unignore only Worklog specifications.
- [ ] `packages/core` and `packages/spec`: retain specification digests on implementations, replace custom observation emission with Effect spans, remove operation IDs and observer APIs, and update focused tests.
- [ ] `packages/observability`, `packages/protocol`, `apps/reference`, and repository scripts: remove the custom stack and all build/release/runtime wiring.
- [ ] `runtimes/go`: remove the custom observation callback, protocol, producer, fixture, and tests without adding replacement tracing.
- [ ] Run narrow package/app checks, Go tests, then the full repository baseline.
- [ ] Update the relevant README/docs, including editor usage, JSON ownership, tracing ownership, and removed commands/routes.
- [ ] Delete this OpenSpec change directory before merge.

## Validation

- `pnpm --filter @specter-ts/spec-editor test && pnpm --filter @specter-ts/spec-editor typecheck && pnpm --filter @specter-ts/spec-editor build`
- `pnpm --filter @specter-ts/core test && pnpm --filter @specter-ts/core typecheck`
- `pnpm --filter @specter/worklog test && pnpm --filter @specter/worklog build`
- `cd runtimes/go && go test ./...`
- `pnpm check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- `node scripts/validate-openspec.mjs`
