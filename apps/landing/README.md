# @specter/landing — Architecture Visuals

A single landing-page variation for Specter, built around one idea: the
specification is a source of truth that Specter can **compile, execute, test,
scaffold, and visualize**. The page leads with an interactive architecture and
dataflow map generated from the same specs, slices, and events a real Specter
project declares.

## Design direction

- **Lead visual:** an SVG architecture map (`ArchitectureMap.tsx`) whose nodes
  are the building blocks of a Specter feature — Client, Specification, Command
  / Query / Reaction slices, Events, and the durable Event Log.
- **Spec ↔ diagram link:** hovering or selecting a node highlights the dataflow
  it participates in and swaps the side panel to the exact specification snippet
  (`architecture.ts`) that produced that node.
- **Intentional color legend:** each node kind has a fixed color (spec = violet,
  slice = cyan, event = amber, event log = emerald, client = slate) so the map
  reads as a real diagram, not decoration.
- **Copy discipline:** "never loses data" is framed as append-only,
  event-sourced design, not magic. No real secrets or API keys appear anywhere.

## Tech

- Vite + Solid + TypeScript, matching the repo's other apps.
- Plain CSS (`styles.css`) for full control over the visual system.
- A small, dependency-free syntax highlighter (`CodeBlock.tsx`).

## Commands

Run from the repo root:

```sh
pnpm --filter @specter/landing dev        # dev server on http://localhost:41733
pnpm --filter @specter/landing build      # production build
pnpm --filter @specter/landing typecheck  # tsc --noEmit
```

Or use the root convenience script for the dev server:

```sh
pnpm dev:landing
```

## Port

The dev and preview servers use fixed port **41733** with `strictPort`, matching
the repo convention (Todo/Booking use `41731`, Threadplane uses `41732`).
