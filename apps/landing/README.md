# @specter/landing — Slice Lab

A standalone landing-page variation for Specter, built as a simple
Vite + Solid + TypeScript single-page app. No backend, no remote assets.

## Design direction: Slice Lab

The page frames Specter as a modular lab for building apps slice-by-slice.
Command, state (query), reaction, test, and external-adapter slices are shown
as small workbenches, each emphasizing three things: small context, local
tests, and independent shipping. The tone is builder-friendly and
fast-feedback.

The copy is intentionally precise: "never loses data" is framed as
event-sourced, append-only durable-event design (state is derived by replaying
an ordered event log), not as a magical guarantee.

## What the page communicates

1. What Specter is and how it works.
2. Structured specs, shown as a concrete Command Slice card.
3. How scenarios attached to slices run as behavior tests.
4. How vertical slices are built and tested independently.
5. How durable, append-only events mean the app never loses what happened.
6. How Specter orchestrates slices through events.
7. How Specter runs anywhere with no opinion on database, protocol, or frontend.
8. How a reaction plugin connects a slice to any external API.
9. How small context + scenario guardrails help AI agents.
10. How structured specs/slices/events can render as architecture/dataflow visuals.
11. A getting-started CTA using `npm create specter`.

## Commands

```sh
pnpm --filter @specter/landing dev        # dev server on http://localhost:41733
pnpm --filter @specter/landing build      # production build to dist/
pnpm --filter @specter/landing preview     # preview the build on 41733
pnpm --filter @specter/landing typecheck  # tsc --noEmit
```

From the repo root, `pnpm dev:landing` starts the dev server.

## Ports

Uses the fixed five-digit port `41733` with `strictPort`, so Vite fails
instead of falling back if the port is occupied. Treat a conflict as something
to investigate rather than swapping ports.
