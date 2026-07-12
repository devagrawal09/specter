# @specter/landing — Slice Lab

A standalone landing-page variation for Specter, built with Vite, Solid, and
TypeScript. It has no backend or remote assets.

## Design direction: Slice Lab

The page presents Specter as a workbench for building one explicit behavior
boundary at a time. Command, Query, and Reaction are the three Slice kinds.
Slice Specifications and Reaction Plugins appear separately as supporting
boundaries rather than additional Slice kinds.

The examples follow the current Specter model:

- `spec.ts` imports `create*Slice` and `event` from `@specter-ts/core/spec` and
  defines only the Slice name, description, and exact scenarios.
- `impl.ts` completes the specification with schemas, a Reaction Plugin when
  applicable, a private Slice Store, typed apply handlers, and a handler.
- `testSliceImplementations` runs registrations against their scenarios with an
  explicit Event Definition catalog and scenario runner.
- Accepted Commands append durable domain facts to the Specter App's ordered
  Event Log; IDs, order, and recorded timestamps remain log metadata.
- Completed Command and Query Slices form a flat, typed client contract.

The getting-started command is `npm create specter@latest my-app`.

## Commands

```sh
pnpm --filter @specter/landing dev        # dev server on http://localhost:41733
pnpm --filter @specter/landing build      # production build to dist/
pnpm --filter @specter/landing preview    # preview the build on port 41733
pnpm --filter @specter/landing typecheck  # tsc --noEmit
```

From the repository root, `pnpm dev:landing` starts the dev server.

## Port

The app uses fixed five-digit port `41733` with `strictPort`. If the port is
occupied, investigate and stop the conflicting process instead of selecting a
different port.
