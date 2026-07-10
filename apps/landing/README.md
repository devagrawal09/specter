# Specter Landing — Compiler Console

A single-page marketing site for Specter, built as a small Vite + Solid + TypeScript app. This is the **Compiler Console** variation: it frames Specter as a product for developers who think in specs-as-source, and walks the reader down a concrete pipeline.

```
spec → behavior test → slice → event log → visual map
```

Each pipeline stage is shown with a real-looking code or console card so the reader can see, not just read, how a structured specification turns into runnable behavior and durable events.

## What the page communicates

- What Specter is and how it works (a TypeScript runtime for vertically sliced, event-sourced apps).
- Structured specs, shown as a concrete command-slice card.
- How scenarios in a spec compile automatically into behavior tests.
- How vertical slices are built and tested independently.
- How the app never loses data — framed as append-only, event-sourced, durable-event design, not magic.
- How slices are orchestrated through events and reactions.
- How Specter runs anywhere and stays unopinionated about database, protocol, and frontend.
- How any external API is reached through an explicit reaction plugin.
- How the structure improves AI coding agents by minimizing context and giving strong guardrails.
- How specs, slices, and events render into a generated architecture/dataflow map.
- A getting-started CTA using `npm create specter`.

## Design

Dark "compiler console" motif: a fixed structural grid, phosphor-green terminal accents, monospace console chrome, and a pipeline that reads top-to-bottom. Copy is intentionally precise and avoids exaggerated claims. No remote assets, no external fonts, no analytics, no secrets.

The code samples are illustrative of Specter's domain language (commands, events, scenarios, slices, reactions, plugins) and are static content — this app does not import `@specter-ts/core` at runtime.

## Run locally

From the repo root:

```sh
pnpm install
pnpm dev:landing
```

The app uses fixed port `41733`. If the port is already occupied, stop the conflicting process instead of letting Vite fall back to another port.

## Commands

```sh
pnpm --filter @specter/landing dev        # start the dev server (port 41733)
pnpm --filter @specter/landing typecheck  # tsc --noEmit
pnpm --filter @specter/landing build      # production build to dist/
pnpm --filter @specter/landing preview     # preview the production build (port 41733)
```
