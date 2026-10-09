# Agent Runtime

A UI-less Specter application that rebuilds OC++ Session Execution (inbox, step, steer, interrupt) spec-first.

```sh
pnpm --filter @specter/agent-runtime test
pnpm --filter @specter/agent-runtime typecheck
```

Plan: `docs/plans/agent-runtime.md`.

## Layout this app expects

`@ocpp/schema`, `@ocpp/ai` and `@ocpp/codemode` are linked from an OC++ checkout at `../ocpp`, a sibling of this repo.

## Embedding in OC++

OC++ core imports the runtime as `@specter/agent-runtime` through `src/index.ts`, never through `@specter-ts/*` directly. That keeps one Specter core in the process.

```sh
pnpm --filter @specter/agent-runtime build       # dist/types: the declarations OC++ type-checks against
cd apps/agent-runtime && bun link                # once per machine; OC++ depends on link:@specter/agent-runtime
```

Bun runs the TypeScript source. OC++ unifies the two copies of `effect` itself: a Bun preload does it at runtime, and `paths` in its tsconfig do it for types.
