# Specter

Specter is a TypeScript framework for vertically sliced event-sourced applications.

This repository is a pnpm workspace:

```txt
packages/core/             @specter-ts/core framework/runtime package
packages/create-specter/   create-specter initializer CLI
apps/reference/            Todo Reference application used as the starter template
apps/booking-reference/    Meeting-room booking Reference application
apps/threadplane-reference/ Threadplane-style workspace Reference application
```

## Create A Project

The published command is:

```sh
npm create specter@latest my-app
```

Use the explicit `@latest` tag in automation so npm does not reuse a stale cached initializer. The initializer also accepts `--install` after `--` to run `npm install`:

```sh
npm create specter@latest my-app -- --install
```

Local verification can point generated apps at a packed or workspace core build:

```sh
SPECTER_CORE_SPEC=file:/absolute/path/to/packages/core node packages/create-specter/dist/index.js my-app
```

## Workspace Commands

```sh
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm dev
pnpm dev:booking
pnpm dev:threadplane
```

The existing Reference applications use fixed port `41731`; the Threadplane Reference application uses fixed port `41732`.

Workspace apps resolve `@specter-ts/core`, `@specter-ts/core/spec`, `@specter-ts/core/client`, and `@specter-ts/core/testing` to local source through `tsconfig.base.json`, so app tests do not require a prebuilt `packages/core/dist`.

## Rust Port Experiment

An additive Rust port lives in [`rust/`](rust/README.md). It preserves Specter's
Event, Slice Specification, Scenario, private Slice State, conformance, Command,
Query, and Reaction concepts and proves them with Todo, Wallet, and Deployment
CLI applications.

```sh
cd rust
cargo test --workspace
cargo run -p todo-cli -- demo
cargo run -p wallet-cli -- demo
cargo run -p deploy-cli -- demo
```

The Rust runtime is currently an experiment, not a replacement for the
published `@specter-ts/core` package. Its parity boundaries and next steps are
documented in the Rust workspace README.

## Slice Specifications And Implementations

Each Slice separates its immutable specification from its executable implementation:

```ts
// add-todo/spec.ts
import { createCommandSlice, event } from '@specter-ts/core/spec'

export const addTodoSpec = createCommandSlice('addTodo')
  .description('Adds a todo to the list.')
  .scenarios({
    description: 'Adds the supplied todo.',
    given: [],
    when: { todoId: 'todo-1', title: 'Ship it' },
    expect: [event('todo-added', { todoId: 'todo-1', title: 'Ship it' })],
  })
```

```ts
// add-todo/impl.ts
export const addTodo = addTodoSpec
  .inputSchema(addTodoInputSchema)
  .store(todoStore)
  .handle(async (command) => [todoAddedEvent.create(command)])
```

Query implementations add `.outputSchema(...)`; Reaction implementations add `.outputSchema(...)` and `.plugin(...)`. After `.store(...)`, implementations may register typed handlers with `.apply(eventDefinition, handler)` before terminating with `.handle(...)`.

Specifications use exact `event(type, payload)` examples and ship with the application. `createSpecterApp(...)` is asynchronous because construction validates all specifications, Event schemas, and selected implementations before exposing the app.

## Release

```sh
pnpm release:dry-run
pnpm release:publish
```

`release:publish` verifies npm auth, runs typecheck/tests/build, then publishes `@specter-ts/core` before `create-specter`.
