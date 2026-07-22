# Introduction

Specter helps applications keep their behavioral intent inspectable while the
runtime grows more capable. Each use case starts as an executable Slice
Specification: a name, a description, and concrete Scenarios. A coding agent or
human can read those examples before navigating persistence, transport, or
framework wiring.

This documentation describes the **0.3 main-branch preview**. The stable npm
release remains 0.2.1.

## Agent-ready specifications

Traditional architecture often scatters one behavior across controllers,
services, repositories, and tests. Specter instead keeps a small specification
beside the code that implements it. The specification is structural data, so it
can be reviewed, tested, and checked for conformance without importing runtime
details.

```ts
import { createCommandSlice, event } from '@specter-ts/spec'

export const addTodoSpec = createCommandSlice('addTodo')
  .description('Adds a todo to the list.')
  .scenarios({
    description: 'Creates a todo with the provided title.',
    given: [],
    when: { todoId: 'todo-1', title: 'Ship it' },
    expect: [event('todo-added', { todoId: 'todo-1', title: 'Ship it' })],
  })
```

The example says what the use case means in domain language. It does not choose
a database, transport, schema library, or server framework.

## Specification and implementation

Every Slice has two required files:

- `spec.ts` exports the immutable Slice Specification. It imports from
  `@specter-ts/spec` and contains only descriptions and Scenarios.
- `impl.ts` exports the completed Slice Implementation. It supplies runtime
  schemas, a private Slice Store, Event apply handlers, a Reaction Plugin when
  needed, and the final handler.

The split lets one specification evaluate different implementations and keeps
operational choices out of the behavioral contract. Both files use named
exports so their relationship remains explicit.

## Commands, Queries, and Reactions

A Specter application composes three Slice kinds:

- A **Command** decides whether to accept an input and emits one or more Events.
  A rejected Command emits no Events.
- A **Query** projects Events into Slice State and returns a public value.
- A **Reaction** projects Events, decides whether an effect is needed, and
  passes that effect to a Reaction Plugin. A plugin can call an external system
  or dispatch a follow-up Command.

All three express behavior through Scenarios. Their implementation builders use
different stages, but share the same `spec.ts` / `impl.ts` boundary.

## Event Log and Slice State

An **Event** is an exact durable domain fact such as `todo-added`. The payload
contains the domain data chosen at the initiating boundary. Event Log IDs,
global order, and recorded timestamps are persistence metadata outside that
payload.

The **Event Log** is the durable source of truth. **Slice State** is a private,
disposable projection rebuilt by applying Events. Commands may maintain a
decision projection, Queries may maintain a read model, and Reactions may track
what effects are needed. One Slice never reaches into another Slice's state;
Events are the integration boundary.

## A typed envelope runtime

A Specter App is created asynchronously because construction checks the
registered Events, selected Slice Implementations, and their specifications
before returning an app.

```ts
const app = await createSpecterApp(config)

const execution = await app.command({
  type: 'addTodo',
  payload: { todoId: 'todo-1', title: 'Ship it' },
})
await execution.reactions

const todos = await app.query({
  type: 'todosQuery',
  payload: { status: 'all' },
})
```

The envelopes use each Slice's name as `type` and its public input as `payload`.
In-process callers use the Specter App directly. Remote clients use a
project-owned transport that carries the same envelopes over HTTP, SSE,
WebSocket, or another protocol. Core deliberately owns no network client or
server.

## Ownership is the architecture

Specter defines behavioral and runtime contracts while the application owns the
choices around them:

- each Slice owns its specification, implementation, and projections;
- the feature registry selects exactly one implementation for each Slice name;
- the application owns Event definitions and registration;
- adapters own Event Log, Slice Store, and Reaction scheduling behavior;
- the project owns transports and framework-specific wiring.

This keeps the framework transport-agnostic and makes operational boundaries
visible in application code.

## Next steps

- [Run the Todo Reference application](getting-started.md).
- [Understand Vertical Slice Architecture](architecture/vertical-slice-architecture.md).
- [Write a Slice Specification](specifications/writing-specifications.md).
- [Browse the API reference](api-reference/README.md).
