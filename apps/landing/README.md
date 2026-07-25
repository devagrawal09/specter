# Specter Landing

A single-page marketing site for Specter, built with Vite, Solid, and
TypeScript.

The page presents Specter as a framework for authoring JSON specifications that
coding agents can turn into complete, well-architected, fully tested
applications. It focuses on three ideas:

- Specter compiles JSON specifications into complete applications with coding
  agents.
- Specter works across application languages, databases, frontend frameworks,
  and realtime infrastructure.
- Procedurally generated scaffolds and tests constrain nondeterministic
  LLM-written code so it follows the specified structure and behavior.

## Design

The compiler-console motif uses a structural grid, terminal-green accents,
monospace chrome, and complementary dark and light themes. The theme switch
follows the system preference until the visitor makes an explicit, persisted
choice.

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
