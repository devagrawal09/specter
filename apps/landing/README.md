# @specter/landing — Agent Guardrails variation

A standalone Vite + Solid + TypeScript landing page for Specter, written for
developers building with AI coding agents.

## Design direction

**Agent Guardrails.** The page argues that Specter makes agents safer and more
effective by:

- **Minimizing context** — an agent loads one slice, its schema, and its
  scenarios instead of the whole repository.
- **Turning intent into executable guardrails** — scenarios are the behavior
  tests, so "done" means the checks pass.
- **Bounding the blast radius** — slices own private state and talk only through
  events, so a change stays local and reviewable.

The visual language uses rails, a bounded "agent context" window, and green
behavior checks. The theme is intentional and readable — no generic AI gradient
slop.

## Content covered

What Specter is and how it works · structured specs as a concrete spec card ·
specs that run as behavior tests · independently built/tested vertical slices ·
durable event-log design (never loses recorded facts) · event-driven slice
orchestration · storage/protocol/frontend agnosticism · connecting to external
APIs through reaction plugins · reduced context and guardrails for agents ·
architecture/dataflow visuals derived from slices and events · a
`npm create specter` getting-started CTA.

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
- Copy is deliberately precise: "never loses data" is framed as event-sourced,
  append-only durability, not magic.
