# Specter

Specter is a TypeScript and Solid framework for building vertically sliced, event-sourced applications that are easy for humans and AI agents to understand, extend, and verify.

The core idea is simple: describe application behavior as typed executable scenarios and contracts, then implement that behavior in independent vertical slices. Those scenarios are not Markdown notes that drift away from the code. They compile with the application, they can be run as tests, and they give agents a precise structure to work inside.

This repository contains Specter's current framework code in `src/lib` and a runnable todo reference app in `src/features/todos`.

## Why Specter Exists

Large applications are hard for agents because behavior is usually spread across horizontal layers: routes, services, repositories, components, jobs, queues, and tests all live in different places. A small feature can require touching many unrelated files, and the actual business rule is often implicit.

Specter pushes the application toward two constraints:

1. Structured contracts: behavior is written in TypeScript with schemas, scenarios, event definitions, and typed slice APIs.
2. Vertical slices: each piece of behavior owns its input contract, state, scenarios, event handlers, and implementation.

That gives you a codebase where a user or an agent can ask, "How does removing a todo work?" and find the command slice that contains the contract, examples, state updates, and handler in one place.

## The Mental Model

A Specter application is built from five concepts:

1. Event Definitions
2. Command Slices
3. Query Slices
4. Reaction Slices
5. Views

Events are the durable facts of the system. Commands decide whether new events should be created. Queries turn events into readable state. Reactions observe events and trigger follow-up work. Views bind queries and commands to UI components.

The global event log is the source of truth. Outside of that event log, every slice owns its own internal state. A command slice can keep exactly the state it needs to validate commands. A query slice can keep exactly the state it needs to answer queries. A reaction slice can keep exactly the state it needs to decide whether to run side effects.

Slices do not directly depend on each other. They communicate through events and command dispatch.

## Runtime Flow

At runtime, Specter works like this:

1. A client dispatches a command.
2. Specter catches the command slice up by applying unread events from the event log into that slice's private state.
3. The command handler queries its private state and returns event drafts, or rejects the command.
4. Accepted event drafts are validated against registered Event Definitions.
5. The Event Log persists accepted events with IDs, order, and timestamps.
6. Query and reaction slices catch up independently by applying events they care about.
7. Views run queries and dispatch commands through typed refs.

This lets each slice be built, tested, and reasoned about independently while still producing one coherent application.

## Project Structure

```txt
src/
  lib/                  Specter framework API and runtime
  features/todos/       Reference todo feature built with Specter
  views/                Solid views bound to Specter Client methods
  db/schema.ts          Drizzle schema exports for migrations
  server.ts             Hono server and Specter API endpoints
  client.tsx            Solid client entrypoint
drizzle/                SQLite migrations
```

The todo feature is the best place to learn the current API:

```txt
src/features/todos/
  events.ts
  registry.ts
  add-todo/slice.ts
  change-todo-completion/slice.ts
  remove-todo/slice.ts
  create-todo-cheer/slice.ts
  todos-view/slice.ts
  todo-cheers/slice.ts
  todo-completion-cheer-reaction/slice.ts
```

## Event Definitions

An Event Definition gives an event type a schema and a constructor. Specter uses Event Definitions to validate event drafts before they are persisted and to decode persisted payloads when slices catch up.

Example from `src/features/todos/events.ts`:

```ts
import * as Schema from 'effect/Schema'
import { createEventDefinition } from '../../lib'

export const todoAddedEvent = createEventDefinition(
  'todoAdded',
  Schema.Struct({
    todoId: Schema.String,
    title: Schema.String,
  }),
)

export const todoCompletionChangedEvent = createEventDefinition(
  'todoCompletionChanged',
  Schema.Struct({
    todoId: Schema.String,
    completed: Schema.Boolean,
  }),
)
```

Create event drafts with `.create()`:

```ts
todoAddedEvent.create({
  todoId: crypto.randomUUID(),
  title: 'Ship it',
})
```

Event drafts do not contain persistence metadata. The Event Log assigns the persisted event ID, order, and recorded timestamp when a command is accepted.

## Command Slices

A Command Slice accepts input and may create events. It can also own private state by applying events before handling a command.

The simplest command has a schema, scenarios, and a handler:

```ts
import * as Schema from 'effect/Schema'
import { createCommandSlice, defineApplyHandlers, rejectCommand } from '../../../lib'
import { todoAddedEvent, todoRemovedEvent } from '../events'

const maxTitleLength = 120

const addTodoSql = createCommandSlice('addTodo')
  .schema(
    Schema.Struct({
      title: Schema.String,
    }),
  )
  .scenarios(
    {
      given: [],
      when: { title: 'Ship it' },
      expect: [
        todoAddedEvent.create({ todoId: 'generated', title: 'Ship it' }),
      ],
    },
    {
      given: [],
      when: { title: '   ' },
      expect: [],
      reject: { reason: 'Todo title is required' },
    },
  )
  .handle((_db, command) => {
    const title = command.title.trim()

    if (!title) {
      return rejectCommand('Todo title is required')
    }

    if (title.length > maxTitleLength) {
      return rejectCommand(
        `Todo title must be ${maxTitleLength} characters or less`,
      )
    }

    return [todoAddedEvent.create({ todoId: crypto.randomUUID(), title })]
  })
```

The scenarios are executable examples. They say what should happen given prior events and a command input. The implementation can change, but the behavior must continue to satisfy the scenarios.

Commands that need state add `.apply()` handlers before `.handle()`. Use `defineApplyHandlers` when you want TypeScript to check handler keys against a specific Event Definition list; bare object literals remain supported but are validated only when the Specter App is created.

```ts
const removeTodoSql = createCommandSlice('removeTodo')
  .schema(Schema.Struct({ todoId: Schema.String }))
  .apply(
    defineApplyHandlers([todoAddedEvent, todoRemovedEvent], {
      [todoAddedEvent.type]: (event, db) => {
        return db.insert(todoRemovalSqlStates).values({
          todoId: event.payload.todoId,
          removed: false,
        })
      },
      [todoRemovedEvent.type]: (event, db) => {
        return db
          .update(todoRemovalSqlStates)
          .set({ removed: true })
          .where(eq(todoRemovalSqlStates.todoId, event.payload.todoId))
      },
    }),
  )
  .handle((db, command) => {
    // Query this command slice's private state, then return events or reject.
  })
```

The state belongs to the command slice. It is not shared application state. It is a local decision cache derived from the Event Log.

## Query Slices

A Query Slice turns events into readable state. Queries are how the UI and API read from the system.

The todo list query owns a table that stores the fields needed to render todos: ID, title, completion state, and removal state. It applies todo events into that table, then handles queries against it.

```ts
const todosSqlQuery = createQuerySlice('todosQuery')
  .schema(
    Schema.Struct({
      status: Schema.Literal('all', 'active', 'completed'),
    }),
  )
  .apply({
    [todoAddedEvent.type]: (event, db) => {
      const payload = todoAddedEvent.decode(event.payload)

      return db.insert(todoSqlListItems).values({
        id: payload.todoId,
        title: payload.title,
        completed: false,
      })
    },
    [todoCompletionChangedEvent.type]: (event, db) => {
      const payload = todoCompletionChangedEvent.decode(event.payload)

      return db
        .update(todoSqlListItems)
        .set({ completed: payload.completed })
        .where(eq(todoSqlListItems.id, payload.todoId))
    },
  })
  .handle((db, query) => {
    // Return the rows matching query.status.
  })
```

Like commands, queries can have scenarios. A query scenario says: given these events, when this query runs, expect this result.

## Reaction Slices

A Reaction Slice observes events and produces side effects or follow-up commands. Reactions are useful for workflows, automations, notifications, emails, background jobs, and cross-slice policies.

In the todo demo, the reaction watches completed todos. When the completed count reaches a multiple of five, it dispatches `createTodoCheer`.

```ts
const todoCompletionCheerSql = createReactionSlice('todoCompletionCheer')
  .apply({
    [todoAddedEvent.type]: (event, db) => {
      const payload = todoAddedEvent.decode(event.payload)

      return db.insert(todoCompletionCheerSqlTodoStates).values({
        todoId: payload.todoId,
        completed: false,
        removed: false,
      })
    },
    [todoCompletionChangedEvent.type]: (event, db) => {
      const payload = todoCompletionChangedEvent.decode(event.payload)

      return db
        .update(todoCompletionCheerSqlTodoStates)
        .set({ completed: payload.completed })
        .where(eq(todoCompletionCheerSqlTodoStates.todoId, payload.todoId))
    },
  })
  .handle((db) => {
    // If a new milestone was reached, return a command envelope.
    return {
      type: 'createTodoCheer',
      payload: { milestone: 5 },
    }
  })
```

Reaction scenarios describe workflow behavior. For example: given five completed todos, expect a `createTodoCheer` command; given that the five-todo cheer already exists, expect no command.

## Views

Views bind query refs and command refs to UI components through the Specter Client context.

The Vite refs plugin scans feature slices and generates typed virtual refs in `src/specter-refs.generated.d.ts`. The Solid views import those refs from `virtual:specter/refs`.

```ts
import { createView } from '../lib/view'
import {
  addTodo,
  changeTodoCompletion,
  removeTodo,
  todosQuery,
} from 'virtual:specter/refs'

export const TodosView = createView('todos-view')
  .queries({ todos: todosQuery })
  .triggers({
    add: addTodo,
    remove: removeTodo,
    change: changeTodoCompletion,
  })
  .scenarios([])
  .component((props) => {
    // props.todos comes from the query.
    // props.add, props.remove, and props.change return Effect values.
  })
```

At runtime the Solid app provides a Specter Client. Components decide when to run trigger Effects and how to represent pending or failed work. Query loading is currently handled by the view runtime while the transport remains the existing Hono HTTP boundary.

This keeps the UI connected to the same slice vocabulary as the backend. The view does not need to know HTTP route details or query endpoint details.

## Registering an App

A Specter app registers its Event Definitions and slices together:

```ts
import addTodoSql from './add-todo/slice'
import changeTodoCompletionSql from './change-todo-completion/slice'
import createTodoCheerSql from './create-todo-cheer/slice'
import removeTodoSql from './remove-todo/slice'
import todoSqlCheers from './todo-cheers/slice'
import todoCompletionCheerSql from './todo-completion-cheer-reaction/slice'
import todosSqlQuery from './todos-view/slice'
import { todoEventDefinitions } from './events'

export const todoSqlRegistrations = [
  addTodoSql,
  changeTodoCompletionSql,
  removeTodoSql,
  createTodoCheerSql,
  todoCompletionCheerSql,
  todosSqlQuery,
  todoSqlCheers,
] as const

export const todoSpecterAppConfig = {
  events: todoEventDefinitions,
  slices: todoSqlRegistrations,
} as const
```

The server creates the app and runtime layer:

```ts
const specterApp = Effect.runSync(createSpecterApp(todoSpecterAppConfig))
const runtimeLayer = createSpecterAppRuntimeLayer({
  sqliteFilename: './data/app.db',
})
```

ADR 0001 commits Specter to Effect RPC as the core transport. The current implementation has not added the Effect RPC packages yet, so the demo server still exposes two HTTP operations behind the Specter Client boundary:

1. `GET /api/query?queryName=...&input=...`
2. `POST /api/command`

Successful commands append events and schedule the reaction queue. Reactions run asynchronously after the command response begins resolving.

## Scenarios As Executable Specs

Specter scenarios are the main reason the framework works well with agents. A scenario is a concrete behavioral example:

```ts
{
  given: [
    todoAddedEvent.create({ todoId: 'todo-1', title: 'Ship it' }),
  ],
  when: { todoId: 'todo-1' },
  expect: [
    todoRemovedEvent.create({ todoId: 'todo-1' }),
  ],
}
```

The scenario says what the slice must do, without requiring the reader to infer behavior from implementation details. If an agent changes the handler and breaks the behavior, the scenario test fails.

Use scenarios for:

1. Happy paths
2. Validation failures
3. Idempotency rules
4. Edge cases
5. Workflow policies
6. Query behavior

When you add a new business rule, add a scenario next to the slice that owns the rule.

## How To Build A Feature

A typical Specter feature follows this order:

1. Define the events that represent durable facts.
2. Write command slices for user/system inputs that can create events.
3. Add scenarios to specify command behavior.
4. Add private slice tables only where a slice needs state to decide or query.
5. Add `.apply()` handlers that derive slice state from events.
6. Add query slices for UI/API reads.
7. Add reaction slices for workflows and automations.
8. Register the slices and Event Definitions in the feature registry.
9. Add views that bind query refs and command refs to UI.
10. Run tests and migrations.

Prefer adding behavior near the slice that owns it. Avoid extracting shared helpers too early. A little duplication between slices is often clearer than a shared abstraction that hides ownership.

## Local Development

Install dependencies:

```bash
npm install
```

Create or update the local SQLite database:

```bash
npm run db:migrate
```

Start the dev server:

```bash
npm run dev
```

The dev server uses the fixed port `41731`.

## Production Build

Build the client and server bundles:

```bash
npm run build
```

Run the built server:

```bash
npm start
```

## Checks

Run the scenario/unit tests:

```bash
npm test
```

Run lint and project import-boundary checks:

```bash
npm run lint
```

Run Biome check:

```bash
npm run check
```

## Database And Migrations

The SQLite database is stored at:

```txt
./data/app.db
```

Generate migrations after schema changes:

```bash
npm run db:generate
```

Apply migrations:

```bash
npm run db:migrate
```

The current demo uses Drizzle tables for the Event Log, slice cursors, and slice-owned state. `src/db/schema.ts` re-exports all tables that Drizzle needs for migration generation.

## Current Status

Specter is still being actively shaped. The current repo proves the core loop:

1. Define typed Event Definitions.
2. Build command, query, and reaction slices.
3. Write scenarios beside the slice implementation.
4. Persist events in SQLite.
5. Derive each slice's private state from the Event Log.
6. Render Solid views through a Specter Client context using typed query and command refs.

The todo app is intentionally small, but it exercises the framework path end to end: commands create events, queries render todos, reactions create milestone cheers, and the UI dispatches commands through generated refs.
