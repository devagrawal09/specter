# File structure

The `create-specter` starter makes ownership visible in the filesystem. It is a
concrete SQLite, Hono, and Solid application layout, not a requirement that all
Specter projects use those technologies.

## Starter tree

```text
my-specter-app/
├── .agents/skills/specter/SKILL.md # agent feature-building contract
├── drizzle/                        # checked-in database migrations
├── scripts/                        # client/server and Slice import checks
├── src/
│   ├── client.tsx                  # browser entry point
│   ├── server.ts                   # adapters, async app creation, HTTP server
│   ├── todo-app.tsx                # UI sends typed project envelopes
│   ├── specter-transport.ts        # client-facing transport facade
│   ├── reaction-scheduler.ts       # project Reaction scheduling boundary
│   ├── db/
│   │   ├── schema.ts               # explicit app schema re-exports
│   │   ├── specter-schema.ts       # Specter persistence tables
│   │   ├── specter-sqlite.ts       # Slice Store/request context
│   │   └── scenario-tests.ts       # isolated Scenario database setup
│   ├── features/
│   │   └── todos/
│   │       ├── events.ts           # feature Event Definition catalog
│   │       ├── registry.ts         # selected Slice Implementations
│   │       ├── scenarios.test.ts   # executable feature specifications
│   │       ├── add-todo/
│   │       │   ├── spec.ts         # required Slice Specification
│   │       │   └── impl.ts         # required Slice Implementation
│   │       ├── todos-query/        # same required pair for a Query
│   │       └── ...
│   └── transport/
│       ├── specter-protocol.ts     # project wire messages and schemas
│       ├── specter-browser.ts      # browser HTTP/SSE implementation
│       └── specter-http.server.ts  # allowlisted server transport
├── tests/e2e/                      # browser acceptance tests
├── drizzle.config.ts
├── package.json
└── vite.config.ts
```

## Required and optional Slice artifacts

Only two files define the Slice boundary:

- `spec.ts` is required and exports the named Slice Specification.
- `impl.ts` is required and exports its named Slice Implementation.

The generator also creates Slice-owned support files when generating a new
Slice bundle: `events.ts`, `projection.ts`, `registry.ts`,
`scenarios.test.ts`, `db-schema.ts`, and `MIGRATION.md`. They are starter
choices. An existing application can keep a feature-level Event catalog or test
suite as the Todo starter does, provided ownership and import boundaries stay
explicit.

## Registration and app wiring

A feature registry exports ordered, readonly arrays of Event Definitions and
completed Slice Implementations. App wiring combines that registry with
adapters:

```ts
const app = await createSpecterApp({
  events: todoEventDefinitions,
  eventLog: persistence.eventLog,
  schedule,
  slices: todoRegistrations,
})
```

Keep `createSpecterApp(...)` in server or in-process runtime wiring and await it.
Construction validates the complete registration before returning the Specter
App.

## Database ownership and migrations

Application tables belong to the Slice that projects them. Define them in
`impl.ts` or an adjacent `projection.ts`, then re-export them from
`src/db/schema.ts` so the migration tool can discover them. `src/db` owns shared
persistence adapter wiring and request-scoped database context; it does not own
the domain projection merely because that projection uses a database.

After adding a generated projection:

1. add its explicit export to `src/db/schema.ts`;
2. run the project's database generation command;
3. inspect the generated SQL migration;
4. run the focused Scenario test against an isolated database.

For durability work, `create-specter generate persistent-harness` creates an
on-disk test harness under `src/testing/persistence` by default. It exercises
restart, replay, cursor failure, and Reaction retry behavior without becoming
production app wiring.

## Transport ownership

Core exposes typed envelope operations but deliberately does not ship an HTTP,
SSE, or WebSocket client/server. Project transport files own:

- the JSON-compatible wire protocol;
- allowlisting registered Command and Query types;
- mapping structured Specter errors;
- keeping request/database context alive for subscription iteration and cleanup.

Browser code imports the project transport. It must not import server modules,
database modules, or a nonexistent `@specter-ts/core/client` entrypoint.

## Import boundaries

- `spec.ts` imports `@specter-ts/core/spec` and implementation-independent
  domain constants only.
- `impl.ts` may import core implementation types, local Event Definitions,
  its private projection, Store adapters, and Reaction Plugins.
- Slices do not import sibling Slices or their state.
- `registry.ts` is the explicit composition boundary for implementations and
  Event Definitions.
- `server.ts` owns adapter construction and lifecycle; UI code owns neither.
- Runtime or Scenario tests use `@specter-ts/core/testing`, not internal source
  paths.

The starter includes boundary-checking scripts so violations fail during lint
instead of becoming architectural convention.

## Related documentation

- [Vertical Slice Architecture](vertical-slice-architecture.md)
- [Runtime](runtime.md)
- [Plugins](plugins.md)
- [`create-specter` CLI](../api-reference/create-specter.md)
