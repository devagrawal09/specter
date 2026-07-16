# Specter

Specter is a Promise-based TypeScript framework for vertically sliced,
event-sourced applications. Applications call a typed envelope API in process;
projects own any HTTP, SSE, WebSocket, or other transport used across process
boundaries.

This repository is a pnpm workspace:

```txt
packages/core/             @specter-ts/core framework/runtime package
packages/memory/           deterministic test adapters and immediate scheduler
packages/sqlite/           persistent SQLite Event Log, Slice Store, and outbox
packages/postgres/         persistent Postgres Event Log, Slice Store, and outbox
packages/reaction-outbox/  durable Reaction attempts, retry, and dead letters
packages/observability/    Event, projection, subscription, and Reaction signals
packages/create-specter/   create-specter initializer CLI
codemods/specter-envelope-api/ deterministic flat API to envelope migration
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
pnpm verify:codemod
pnpm verify:starter
pnpm dev
pnpm dev:booking
pnpm dev:threadplane
```

The existing Reference applications use fixed port `41731`; the Threadplane Reference application uses fixed port `41732`.

Workspace apps resolve `@specter-ts/core`, `@specter-ts/core/spec`, and
`@specter-ts/core/testing` to local source through `tsconfig.base.json`, so app
tests do not require a prebuilt `packages/core/dist`.

## Runtime Envelopes

Core deliberately does not include a network client or server. A Specter App
has three operations:

```ts
const execution = await app.command({
  type: 'addTodo',
  payload: { todoId: 'todo-1', title: 'Ship it' },
})

// The Events are durable when command resolves. Reaction completion is
// represented separately and may fail without undoing that commit.
await execution.reactions

const todos = await app.query({
  type: 'todosQuery',
  payload: { status: 'open' },
})

for await (const latest of app.subscribe({
  type: 'todosQuery',
  payload: { status: 'open' },
})) {
  console.log(latest)
}
```

The generated project contains the canonical JSON HTTP/SSE transport. It
allowlists registered envelope types, maps stable structured errors, and
supports reconnectable latest-state query subscriptions. In-process programs
can use the same app API directly.

See [Runtime and transport boundaries](docs/guides/runtime-boundaries.md) for
transaction, subscription, schema-mode, idempotency, adapter, and operational
guidance.

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

`create-specter generate slice` emits named `spec.ts`/`impl.ts` exports plus
optional Slice-owned Event, projection, registry, test, schema-export, and
migration support files. `create-specter generate persistent-harness` emits an
executable SQLite restart/replay/reset harness with durable Reaction scheduling
and wired failure injection. Use `analyzeEventPropagation(...)` from
`@specter-ts/core/testing` before evolving an Event payload.

## Release

```sh
pnpm release:dry-run
pnpm release:publish
```

The unpublished `0.3.0` release set contains `@specter-ts/core`,
`@specter-ts/memory`, `@specter-ts/sqlite`, `@specter-ts/postgres`,
`@specter-ts/reaction-outbox`, `@specter-ts/observability`, and
`create-specter`. Release verification builds every publishable package before
workspace typechecks/tests, validates the envelope codemod package, packs and
tests a generated starter, and runs that starter's Playwright workflow.

`release:auth` checks all seven names. It verifies that the authenticated npm
identity owns every package that already exists. A 404 is recorded explicitly
as an unpublished, first-publish package rather than mistaken for an auth
failure; those names require `@specter-ts` scope publication rights. On later
releases the same verifier automatically requires their newly available owner
metadata.
