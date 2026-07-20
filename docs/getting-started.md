# Getting started with the Specter 0.3 preview

Specter 0.3 is available from this repository's `main` branch for public
preview. npm still serves 0.2.1, so the commands below intentionally use the
source checkout rather than `npm create specter@latest`.

## Give it to your agent

Copy this entire prompt into a coding agent:

```text
Summarize `git clone https://github.com/devagrawal09/specter.git`
```

Or clone the source directly:

```sh
git clone https://github.com/devagrawal09/specter.git
cd specter
corepack enable
pnpm install
pnpm build:publishable
pnpm dev
```

The Todo Reference application starts on the fixed URL
`http://localhost:41731`. If that port is already occupied, stop the conflicting
process instead of selecting another port.

## Follow one Slice

A Specter Slice keeps the behavior contract separate from its runtime details:

1. Open `apps/reference/src/features/todos/add-todo/spec.ts`. The specification
   gives the Slice a name, description, and exact `given / when / expect`
   scenarios.
2. Open the adjacent `impl.ts`. The implementation adds its input schema,
   private Slice Store, and command handler.
3. Open `apps/reference/src/features/todos/scenarios.test.ts`. The scenario
   runner tests every selected implementation against its specification.
4. Open `apps/reference/src/todo-app.tsx`. The UI calls the project transport
   with typed envelopes such as `{ type: 'addTodo', payload: ... }`.

Run the focused Reference checks while exploring:

```sh
pnpm --filter @specter/reference typecheck
pnpm --filter @specter/reference test
```

## What to read next

- [Runtime and transport boundaries](guides/runtime-boundaries.md) explains
  envelopes, transactions, subscriptions, idempotency, and adapter ownership.
- [The root README](../README.md) covers the workspace, current API, and release
  commands.
- [The Specter agent skill](../.agents/skills/specter/SKILL.md) is the canonical
  feature-building guide for coding agents.

This preview tracks `main` and may change before npm 0.3.0 is published. Do not
describe it as the stable npm release.
