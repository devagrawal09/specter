# Specter

Specter is a TypeScript framework for vertically sliced, event-sourced
applications. It provides an Effect-native runtime with a Promise facade for
non-Effect callers. Projects own any HTTP, SSE, WebSocket, or other transport
used across process boundaries.

> **0.4 main-branch preview:** the repository currently documents the upcoming
> 0.4 API. npm remains on 0.2.1. To explore the preview, see
> [Getting started from main](docs/getting-started.md) or give this prompt to a
> coding agent: `Summarize \`git clone https://github.com/devagrawal09/specter.git\``.

This repository is a pnpm workspace:

```txt
packages/core/             @specter-ts/core framework/runtime package
packages/spec/             @specter-ts/spec portable authoring and export package
packages/memory/           deterministic test adapters and immediate scheduler
packages/sqlite/           persistent SQLite Event Log, Slice Store, and outbox
packages/sqlite-node/      scoped native node:sqlite runtime bundle
packages/postgres/         persistent Postgres Event Log, Slice Store, and outbox
packages/reaction-outbox/  durable Reaction attempts, retry, and dead letters
packages/protocol/         language-neutral v1 observation types and validation
packages/observability/    shared collector, dashboard, CLI, and telemetry producer
packages/create-specter/   create-specter initializer CLI
protocol/                  normative schemas, behavior, and golden fixtures
runtimes/go/               independent Go 1.24 runtime and Todo reference app
codemods/specter-json-specs/ deterministic 0.3-to-0.4 JSON-spec migration
apps/reference/            Todo Reference application used as the starter template
apps/booking-reference/    Meeting-room booking Reference application
apps/threadplane-reference/ Threadplane-style workspace Reference application
```

## Published Stable Release

The current npm release is 0.2.1. Its published command is:

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

For the unreleased 0.4 API shown in this README, use the
[main-branch preview guide](docs/getting-started.md) instead of the npm command.

## Documentation

- [Documentation hub](docs/README.md)
- [Getting started from main](docs/getting-started.md)
- [OpenSpec workflow](docs/guides/openspec.md)
- [Specter runtime](docs/architecture/runtime.md)
- [API reference](docs/api-reference/README.md)

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

The Todo and Booking Reference applications use fixed port `41731`; the
Threadplane Reference uses `41732`, Personal Mail uses `41738`, the
observability collector uses `41739`, and the Go Todo reference uses `41737`.

Workspace apps resolve `@specter-ts/core` and `@specter-ts/core/testing` to
local source through `tsconfig.base.json`. Root build, test, and typecheck
scripts build `@specter-ts/spec` once, export adjacent `spec.json` files, then
run dependent packages.

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
  payload: { status: 'active' },
})

for await (const latest of app.subscribe({
  type: 'todosQuery',
  payload: { status: 'active' },
})) {
  console.log(latest)
}
```

The generated project contains the canonical JSON HTTP/SSE transport. It
allowlists registered envelope types, maps stable structured errors, and
supports reconnectable latest-state query subscriptions. In-process programs
can use the same app API directly.

See [Specter runtime](docs/architecture/runtime.md) for transaction,
subscription, schema-mode, idempotency, adapter, and operational guidance.

## Slice Specifications And Implementations

Each Slice separates its immutable specification from its executable implementation:

```ts
// add-todo/spec.ts
import { createCommandSlice, event } from '@specter-ts/spec'

export const addTodoSpec = createCommandSlice('addTodo')
  .description('Adds a todo to the list.')
  .scenarios({
    description: 'Adds the supplied todo.',
    given: [],
    when: { todoId: 'todo-1', title: 'Ship it' },
    expect: [event('todo-added', { todoId: 'todo-1', title: 'Ship it' })],
  })

export default addTodoSpec
```

```ts
// add-todo/impl.ts
import { implementCommand } from '@specter-ts/core'
import specification from './spec.json' with { type: 'json' }

export const addTodo = implementCommand(specification)
  .inputSchema(addTodoInputSchema)
  .store(todoStore)
  .handle(async (command) => [todoAddedEvent.create(command)])
```

Query implementations add `.outputSchema(...)`; Reaction implementations add `.outputSchema(...)` and `.plugin(...)`. After `.store(...)`, implementations may register typed handlers with `.apply(eventDefinition, handler)` before terminating with `.handle(...)`.

Specifications use exact `event(type, payload)` examples. `specter-spec export` converts each `spec.ts` to an adjacent `spec.json`; TypeScript and non-TypeScript implementations consume only that portable JSON. `createSpecterApp(...)` is asynchronous because construction validates all specifications, Event schemas, and selected implementations before exposing the app.

`create-specter generate slice` emits a default-exported `spec.ts`, a JSON-backed named `impl.ts` export, plus
optional Slice-owned Event, projection, registry, test, schema-export, and
migration support files. Use `analyzeEventPropagation(...)` from
`@specter-ts/core/testing` before evolving an Event payload.

## Release

```sh
pnpm release:dry-run
pnpm release:publish
```

The unpublished `0.4.0` release set contains `@specter-ts/spec`,
`@specter-ts/core`,
`@specter-ts/memory`, `@specter-ts/sqlite`, `@specter-ts/postgres`,
`@specter-ts/sqlite-node`, `@specter-ts/reaction-outbox`, `@specter-ts/protocol`,
`@specter-ts/observability`, and
`create-specter`. Release verification builds every publishable package before
workspace typechecks/tests, validates the JSON-spec migration codemod, packs and
tests a generated starter, and runs that starter's Playwright workflow.

`release:auth` checks all nine names. It verifies that the authenticated npm
identity owns every package that already exists. A 404 is recorded explicitly
as an unpublished, first-publish package rather than mistaken for an auth
failure; those names require `@specter-ts` scope publication rights. On later
releases the same verifier automatically requires their newly available owner
metadata.
