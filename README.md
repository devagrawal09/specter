# Specter

Specter is a TypeScript framework for vertically sliced event-sourced applications, with first-party reference apps that show how app developers and coding agents can build against the same domain model.

> **Public status:** Specter is being prepared in public. The framework, initializer, and reference apps are MIT-licensed; deeper public docs are being added through focused pull requests.

## Repository Map

```txt
packages/core/             @specter-ts/core framework/runtime package
packages/create-specter/   create-specter initializer CLI
apps/reference/            Todo Reference application used as the starter template
apps/booking-reference/    Meeting-room booking Reference application
apps/threadplane-reference/ Threadplane-style workspace Reference application
```

## Prerequisites

- Node.js 24 or newer
- pnpm 11.1.3, matching the root `packageManager` field

```sh
corepack enable
corepack prepare pnpm@11.1.3 --activate
pnpm install
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
pnpm check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm dev
pnpm dev:booking
pnpm dev:threadplane
```

The existing Reference applications use fixed port `41731`; the Threadplane Reference application uses fixed port `41732`.

Workspace apps resolve `@specter-ts/core`, `@specter-ts/core/client`, and `@specter-ts/core/testing` to local source through `tsconfig.base.json`, so app tests do not require a prebuilt `packages/core/dist`.

## Slice Scenarios

Slices are created with a stable name and a human-readable description:

```ts
createCommandSlice('addTodo', 'Adds a todo to the list.')
```

Every scenario also has a `description`. `testScenarios` uses slice descriptions for suite names and scenario descriptions for test names.

## Agent-Friendly Development

Specter apps are organized so people and coding agents can work feature-by-feature. Keep changes small, prefer executable scenarios, and document the Specter concept an app or package demonstrates.

## Contributing

This repo uses pull requests instead of GitHub issues for work tracking. See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Release

```sh
pnpm release:dry-run
pnpm release:publish
```

`release:publish` verifies npm auth, runs typecheck/tests/build, then publishes `@specter-ts/core` before `create-specter`.
