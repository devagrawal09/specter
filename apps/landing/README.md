# @specter/landing — Event Flow variation

A single landing-page variation for Specter, built as a small Vite + Solid + TypeScript SPA.

## Design direction: Event Flow

The page is centered on Specter's durable event log and its orchestration model. The
core visual is an event dataflow: **user intent → command → durable events → read models
and reactions → adapters** (database, protocol, frontend, external API). An append-only
event ledger makes the no-data-loss story concrete, and the "never loses data" claim is
framed as a property of event-sourced design (state is a replay of durable, ordered
events), not as a magic guarantee.

Tone is systems-architecture: robust, calm, readable. Styling is hand-written CSS with a
blueprint grid and a restrained teal / amber / blue palette — no gradient slop, no remote
assets.

## What it communicates

- What Specter is and how a change flows through it.
- Structured specs shown as a concrete command-slice card.
- How scenarios attached to a slice run as behavior tests.
- How vertical slices are built and tested independently.
- Why the app never loses data (durable, append-only, replayable event log).
- How reactions orchestrate slices through events.
- How Specter runs anywhere with no opinion on database, protocol, or frontend.
- How any external API is connected through an explicit reaction plugin.
- How the slice shape keeps AI coding agents focused with minimal context and guardrails.
- How specs, slices, and events can be rendered as architecture/dataflow diagrams.
- A getting-started CTA using `npm create specter`.

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
