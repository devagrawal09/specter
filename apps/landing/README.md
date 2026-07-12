# @specter/landing — Event Flow variation

A single landing-page variation for Specter, built as a small Vite + Solid + TypeScript SPA.

## Design direction: Event Flow

The page is centered on Specter's Event Log and orchestration model. The core visual is
an event dataflow: **caller → typed Specter Client → Command implementation → durable
events → Query and Reaction implementations**. It distinguishes immutable `spec.ts`
files from executable `impl.ts` files and makes the storage caveat explicit: recovery
depends on an Event Log adapter backed by atomic commits, durable storage, and backups.

Tone is systems-architecture: robust, calm, readable. Styling is hand-written CSS with a
blueprint grid and a restrained teal / amber / blue palette — no gradient slop, no remote
assets.

## What it communicates

- What Specter is and how a change flows through it.
- A concrete Command Slice split between its specification and implementation.
- How `testSliceImplementations` turns Scenarios into executable checks.
- How vertical slices are built and tested independently.
- Why a durable, append-only Event Log makes state replayable.
- How a Reaction Effect is interpreted by its explicit Reaction Plugin.
- How Specter runs anywhere with no opinion on database, protocol, or frontend.
- How any external API is connected through an explicit reaction plugin.
- How the slice shape keeps AI coding agents focused with minimal context and guardrails.
- How explicit Slice and Event relationships support architecture reasoning.
- A getting-started CTA using `npm create specter@latest my-app`.

## Commands

```sh
pnpm --filter @specter/landing dev        # dev server on http://localhost:41733
pnpm --filter @specter/landing build      # production build to dist/
pnpm --filter @specter/landing preview    # preview the build on port 41733
pnpm --filter @specter/landing typecheck  # tsc --noEmit
```

From the repo root you can also run `pnpm dev:landing`. The dev and preview servers use
the fixed port `41733` with `strictPort` enabled, so Vite fails on a conflict instead of
falling back to another port.
