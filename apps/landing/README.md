# @specter/landing — Agent Guardrails variation

A standalone Vite + Solid + TypeScript landing page for Specter, written for
developers building with AI coding agents.

## Design direction

**Agent Guardrails.** The page argues that Specter makes agents safer and more
effective by:

- **Focusing context** — a vertical feature keeps each immutable `spec.ts` near
  its selected `impl.ts` and shared Event Definitions.
- **Turning intent into executable guardrails** — an explicit
  `testSliceImplementations` runner checks the production Scenarios.
- **Making blast radius visible** — Slices own private state and coordinate
  through registered Events, so cross-Slice effects remain reviewable.

The visual language uses rails, a bounded "agent context" window, and green
behavior checks. The theme is intentional and readable — no generic AI gradient
slop.

## Content covered

What Specter is and how it works · structured specs as a concrete spec card ·
Scenarios checked by the testing helper · independently built/tested vertical
slices · replay from a durable Event Log adapter · explicit Reaction Effects and
Plugins · storage/protocol/frontend agnosticism · focused context and guardrails
for agents · an illustrative architecture map · a
`npm create specter@latest my-app` getting-started CTA.

The hero headline is fixed: `specifications that compile execute and scaffold your app`.

## Commands

```sh
pnpm --filter @specter/landing dev        # dev server on http://localhost:41733
pnpm --filter @specter/landing build      # production build to dist/
pnpm --filter @specter/landing preview    # preview the build on 41733
pnpm --filter @specter/landing typecheck  # tsc --noEmit
```

From the repo root:

```sh
pnpm dev:landing
```

## Ports

Uses fixed five-digit port `41733` with `strictPort` enabled for both dev and
preview, alongside `41731` (Todo/Booking) and `41732` (Threadplane).

## Notes

- Pure Vite + Solid + hand-written CSS. No UI framework, no remote assets, no
  secrets or API keys.
- Copy distinguishes the framework contract from app-provided durability:
  atomic commits, durable storage, backups, and recovery remain adapter concerns.
