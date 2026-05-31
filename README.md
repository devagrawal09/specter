# Specter

Specter is a TypeScript and Solid framework for vertically sliced event-sourced applications.

This repository is a pnpm workspace:

```txt
packages/core/             @specter-ts/core framework/runtime package
packages/create-specter/   create-specter initializer CLI
apps/reference/            Todo Reference application used as the starter template
apps/booking-reference/    Meeting-room booking Reference application
```

## Create A Project

The published command is:

```sh
npm create specter@latest my-app
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
```

The dev and preview servers use the fixed port `41731`.

Workspace apps resolve `@specter-ts/core`, `@specter-ts/core/client`, and `@specter-ts/core/testing` to local source through `tsconfig.base.json`, so app tests do not require a prebuilt `packages/core/dist`.

## Slice Scenarios

Slices are created with a stable name and a human-readable description:

```ts
createCommandSlice('addTodo', 'Adds a todo to the list.')
```

Every scenario also has a `description`. `testScenarios` uses slice descriptions for suite names and scenario descriptions for test names.

## Release

```sh
pnpm release:dry-run
pnpm release:publish
```

`release:publish` verifies npm auth, runs typecheck/tests/build, then publishes `@specter-ts/core` before `create-specter`.
