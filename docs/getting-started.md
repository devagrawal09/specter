# Getting started with Specter 0.4

Specter 0.4 is available from this repository's `main` branch. npm still serves
0.2.1, so this guide intentionally uses the source checkout instead of
`npm create specter@latest`.

## Clone and run

```sh
git clone https://github.com/devagrawal09/specter.git
cd specter
corepack enable
pnpm install
pnpm build:publishable
```

Start the Todo Reference application in one terminal:

```sh
pnpm dev
```

Open `http://localhost:41731`. This fixed port belongs to the Todo Reference
application. If it is occupied, investigate the conflicting process; Vite is
configured to fail instead of silently choosing another port.

To see specifications and telemetry together, start the collector in another
terminal before exercising the Todo app:

```sh
node packages/observability/dist/cli.js serve
```

Open `http://127.0.0.1:41739`. The Todo runtime publishes all loaded
specifications at startup and sends correlated telemetry without blocking
application execution. Publication includes complete synthetic Scenario
values, so treat the collector as trusted local or team infrastructure.

## Trace the `addTodo` Slice

The Todo Reference application shows the complete path from TypeScript
authoring to a portable contract, an implementation, and the UI without hiding
the boundaries.

### 1. Read the Slice Specification

Open
[`apps/reference/src/features/todos/add-todo/spec.ts`](../apps/reference/src/features/todos/add-todo/spec.ts).
The `addTodoSpec` value defines the Command's name, description, accepted
Scenarios, and rejected Scenarios. The module also default-exports that one
specification so the exporter can discover it unambiguously. Its exact
`event('todo-added', payload)` examples contain no schema, database, or server
code.

### 2. Build the portable contract

Run the same exporter used by the reference app's development, typecheck, test,
and build scripts:

```sh
pnpm --filter @specter/reference spec:build
```

This executes `spec.ts` in an isolated TypeScript process and writes ignored,
adjacent `spec.json`. That strict, versioned JSON document contains only the
Slice identity, description, and exact Scenarios. TypeScript implementations,
the Go runtime, conformance tools, and the dashboard all consume this portable
contract rather than importing `spec.ts`.

### 3. Read the Slice Implementation

Open the adjacent
[`impl.ts`](../apps/reference/src/features/todos/add-todo/impl.ts). It imports
the generated `spec.json`, passes it to `implementCommand`, and exports the
named `addTodo` implementation after completing these stages:

```text
inputSchema -> store -> apply (zero or more) -> handle
```

The runtime schema validates the public Command input. The private Slice Store
would hold any decision projection. The handler trims and checks the title, then
creates the typed `todo-added` Event defined by the feature.

### 4. Follow registration into the runtime

[`registry.ts`](../apps/reference/src/features/todos/registry.ts) collects the
Todo Event definitions and selected Slice Implementations into one typed config.
[`server.ts`](../apps/reference/src/server.ts) creates persistence adapters and
Store Layers, then awaits Specter App:

```ts
const specterApp = await createSpecterApp(todoSpecterAppConfig, dependencies)
```

Construction checks conformance before the server starts accepting operations.

### 5. Follow the envelope from the UI

[`todo-app.tsx`](../apps/reference/src/todo-app.tsx) creates the domain ID at the
initiating boundary and sends a typed Command envelope through the project's
transport:

```ts
await runSpecterCommand({
  type: 'addTodo',
  payload: { todoId: crypto.randomUUID(), title },
})
```

The project-owned HTTP transport allowlists registered envelope types and maps
structured Specter errors. In-process code could pass the same envelope directly
to `specterApp.command(...)`.

## Run the focused checks

The feature Scenario suite selects the Todo registrations and Event catalog,
then runs every implementation against its generated portable specification.
Both commands regenerate `spec.json` first.

```sh
pnpm --filter @specter/reference typecheck
pnpm --filter @specter/reference test
```

When changing the workspace itself, use the full repository baseline before
calling the change complete:

```sh
pnpm check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Read next

- [Introduction](introduction.md) for the complete mental model.
- [Vertical Slice Architecture](architecture/vertical-slice-architecture.md)
  for ownership and dependency rules.
- [Writing specifications](specifications/writing-specifications.md) and
  [Slice tests](specifications/slice-tests.md) for executable Scenarios.
- [Portable specification format](../specification/README.md) for the
  language-neutral JSON contract and digest rules.
- [`@specter-ts/spec` API](api-reference/spec.md) for the exact
  builders and types.
- [Runtime architecture](architecture/runtime.md) for transactions,
  subscriptions, and Reaction completion.
- [Observability API](api-reference/observability.md) for specification
  publication, telemetry correlation, and the unified dashboard.

The unreleased 0.4 documentation tracks `main` and may change before npm 0.4.0
is published. Do not describe it as the stable npm release.
