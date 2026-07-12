# @specter/landing — Architecture Visuals

A landing-page variation for Specter built around the separation between an
immutable Slice Specification and its selected Slice Implementation. The lead
visual is a conceptual map of current framework contracts; it is deliberately
not presented as generated project output.

## Design direction

- **Lead visual:** an interactive SVG map (`ArchitectureMap.tsx`) connecting the
  typed Client, Slice Specifications, selected implementations, Specter App,
  Event Definitions, Event Log, and Reaction Plugin boundary.
- **Contract ↔ code link:** hovering, focusing, or selecting a node highlights
  its nearest dataflow and swaps the side panel to a representative current-API
  example from `architecture.ts`.
- **Specification accuracy:** examples follow the current `spec.ts` / `impl.ts`
  split, use `@specter-ts/core/spec` for behavior scenarios, keep domain IDs in
  Command input, and model Reaction effects through explicit plugins.
- **Conceptual honesty:** the diagram explains Specter's architecture but is not
  generated from the displayed source. The Project Initializer copies the Todo
  reference application; it does not scaffold individual features or regenerate
  this map.
- **Accessible interaction:** toolbar buttons and SVG nodes support keyboard and
  pointer selection, the code panel has an accessible caption, and the mobile
  diagram remains readable through a labelled horizontal scroll region.

## Tech

- Vite + Solid + TypeScript, matching the repository's other applications.
- Plain CSS (`styles.css`) for the visual system and responsive layout.
- A small, dependency-free syntax highlighter (`CodeBlock.tsx`).

## Commands

Run from the repository root:

```sh
pnpm --filter @specter/landing dev        # http://localhost:41733
pnpm --filter @specter/landing build
pnpm --filter @specter/landing typecheck
```

Or use the root convenience script:

```sh
pnpm dev:landing
```

## Port

The dev and preview servers use fixed port **41733** with `strictPort`. Todo and
Booking use `41731`, Threadplane uses `41732`, and Specter Code uses `41734`.
