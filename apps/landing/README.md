# Specter Landing — Compiler Console

A single-page marketing site for Specter, built with Vite, Solid, and
TypeScript. The **Compiler Console** variation presents Specter's explicit
application pipeline:

```text
specification → implementation → scenario tests → event log → typed envelope
```

The examples follow the current Specter API. A Slice Specification in `spec.ts`
imports from `@specter-ts/core/spec` and contains only its name, description,
and exact scenarios. A separate `impl.ts` completes schemas, a Reaction Plugin
when applicable, private Slice State, apply handlers, and the terminal handler.
`testSliceImplementations` runs the selected implementations against their
specifications, while app construction validates conformance before exposing
the runtime.

## What the page communicates

- Specter is a TypeScript framework for vertically sliced, event-sourced apps.
- Command, Query, and Reaction Slices separate the immutable “what” from the
  executable “how.”
- Scenario Events use exact payload examples and Event types use kebab-case.
- Accepted Commands append domain facts to one ordered Event Log.
- Each Slice owns private state and catches up by applying relevant Events.
- Reaction Plugins interpret typed outputs, including external API calls.
- Completed Slices expose typed command, query, and subscription envelopes.
- The public preview points agents at the 0.3 source on `main`; npm remains on
  the stable 0.2.1 release.

## Design

The dark compiler-console motif uses a structural grid, terminal-green accents,
monospace chrome, and a top-to-bottom pipeline. Code samples are static content;
the landing app does not import `@specter-ts/core` at runtime.

## Run locally

From the repository root:

```sh
pnpm install
pnpm dev:landing
```

The app uses fixed port `41733`. If the port is occupied, stop the conflicting
process instead of allowing Vite to select another port.

## Commands

```sh
pnpm --filter @specter/landing dev        # start on port 41733
pnpm --filter @specter/landing typecheck  # tsc --noEmit
pnpm --filter @specter/landing build      # production build to dist/
pnpm --filter @specter/landing preview    # preview on port 41733
```
