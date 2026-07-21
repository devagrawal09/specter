# CQRS in Specter

Specter separates work that changes the application from work that reads it.
A Command Slice decides whether to accept an intent and emits Events. A Query
Slice projects Events into a read model and returns a value. A Reaction Slice
projects Events and invokes a Reaction Plugin for side effects. This separation
keeps each behavior inspectable and gives each Slice the smallest State it
needs.

## Three kinds of Slice

| Slice | Input | Reads | Produces |
| --- | --- | --- | --- |
| Command | A typed Command envelope | Its private decision projection | One or more durable Events, or a rejection |
| Query | A typed Query envelope | Its private read projection | A validated result |
| Reaction | Newly applied Events | Its private effect projection | An optional value for a Reaction Plugin |

Commands and Queries use the same envelope shape:

```ts
await app.command({
  type: 'addTodo',
  payload: { todoId: 'todo-1', title: 'Ship it' },
})

await app.query({
  type: 'todosQuery',
  payload: { status: 'active' },
})
```

The registered Slice names make `type` a discriminant, so TypeScript checks the
matching payload and Query result. A project-owned transport can preserve that
same envelope contract across HTTP, RPC, a queue, or another boundary.

## Todo: decide once, project independently

The Todo Reference app has an `addTodo` Command Slice and a `todosQuery` Query
Slice. `addTodo` validates and trims the title, then emits the exact domain fact:

```ts
return [todoAddedEvent.create({ todoId: command.todoId, title })]
```

`todosQuery` applies `todo-added`, `todo-completion-changed`, and `todo-removed`
to its own SQL table. Its handler only filters and returns that projection. A
separate `todoCompletionCheer` Reaction Slice applies the Events it needs and
asks its plugin to dispatch `createTodoCheer` when a milestone is reached.

All three Slices can interpret the same Event stream differently without
importing one another or sharing mutable State.

## Decision flow

1. Core decodes the Command input.
2. Inside an Event Log transaction, core catches up the Command Slice's private
   projection.
3. The Command handler decides from that projection and returns Event drafts.
4. Core validates that the Events are authorized by accepted Scenarios and
   appends them with compare-and-swap.
5. Query and Reaction projections catch up from the committed Events.

The Event Log transaction—not a Query projection—is the decision boundary.
Queries may lag, be rebuilt, or use a different storage engine, so a Command
must never consult a Query Slice to decide whether an intent is valid.

## Invariants and pitfalls

- A Command emits durable facts; it does not update a Query's tables directly.
- A Query returns current projected State; it does not emit Events or drive a
  Command decision.
- A Reaction performs effects only through its Reaction Plugin. Reaction
  failure cannot roll back the Command that produced its input Events.
- Each Slice owns its projection and imports shared Event Definitions or
  registry-level references, not sibling Slices.
- Command handlers receive read-only State. Only apply handlers receive the
  write capability.
- Runtime schemas are required at untrusted boundaries. Type-only schema calls
  provide static types but no runtime validation.

## Related documentation

- [Introduction](../introduction.md)
- [Vertical Slice Architecture](vertical-slice-architecture.md)
- [Event Sourcing](event-sourcing.md)
- [Runtime](runtime.md)
- [Core runtime API](../api-reference/core-runtime.md)
- [Slice tests](../specifications/slice-tests.md)
- [Documentation](../README.md)
