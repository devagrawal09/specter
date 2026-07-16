# Specter for Rust

This directory is an additive, executable Rust port of the Specter 0.3 model. It tests
whether Specter's core model remains useful and ergonomic when Rust replaces
TypeScript; it does not replace the published `@specter-ts/core` package.

## What Works

The `specter` crate currently provides:

- typed Event payloads through `DomainEvent` and Serde;
- exact, string-typed Scenario Events that keep specifications independent from
  implementation-owned Event definitions;
- immutable Command, Query, and Reaction Slice Specifications;
- staged implementation builders for input, output, private state, apply
  handlers, reaction executors, and terminal handlers;
- a transactional Event Log adapter with filtered ordered reads, version CAS,
  idempotency receipts, and atomic duplicate detection;
- private event-derived state and a cursor per Slice implementation;
- erased transport envelopes plus typed `CommandRef<I>` and `QueryRef<I, O>`
  application APIs;
- `CommandExecution` receipts that separate durable Event commit from
  asynchronous Reaction completion;
- latest-state Query subscriptions with initial delivery and coalescing;
- stable Reaction delivery IDs, attempt metadata, aggregate failure tickets,
  and best-effort runtime observation hooks;
- construction-time conformance diagnostics;
- runtime enforcement that Commands emit at least one Event and only Event
  types declared by accepted Scenario outcomes;
- executable Scenario suites against fresh private state;
- Reaction effects that may perform work and optionally dispatch a follow-up
  Command envelope.

App construction checks the same high-value authoring invariants as the
TypeScript runtime: unique lower-camel Slice names, unique kebab-case Event types,
non-empty and uniquely described Scenarios, registered/lossless Scenario Event
payloads, complete Event coverage, and exact equality between the union of
Given Event types and implementation apply-handler Event types.

## Workspace

```text
rust/
├── crates/specter/   Core runtime, conformance, scenarios, and tests
└── apps/
    ├── todo-cli/     Query projection plus a three-completion milestone Reaction
    ├── wallet-cli/   Decision state plus rejected overdraft behavior
    ├── deploy-cli/   Approval Reaction that dispatches start-deployment
    ├── inventory-cli/ Typed refs, optimistic versioning, idempotency, subscriptions
    └── incident-cli/ Reaction delivery context plus a follow-up Command
```

Each CLI mirrors the generated TypeScript project layout. Rust uses snake_case
directory names for modules, while keeping the same feature and Slice
boundaries:

```text
src/
├── main.rs                         CLI wiring only
└── features/
    └── <feature>/
        ├── events.rs               Feature-owned Event definitions
        ├── registry.rs             Selected implementations and app wiring
        ├── scenarios.rs            Feature Scenario test
        └── <slice>/
            ├── mod.rs              Rust module exports
            ├── spec.rs             Name, description, and Scenarios only
            └── impl.rs             Types, private state, apply, and handler
```

`spec.rs` files import only Specter specification APIs and
implementation-independent example data. They do not import Event definitions,
private state, sibling Slices, registries, or runtime wiring.

Each CLI supports a scripted `demo` and a `verify` command that executes all of
its production Scenarios:

```sh
cd rust

cargo run -p todo-cli -- demo
cargo run -p todo-cli -- verify

cargo run -p wallet-cli -- demo
cargo run -p wallet-cli -- verify

cargo run -p deploy-cli -- demo
cargo run -p deploy-cli -- verify

cargo run -p inventory-cli -- demo
cargo run -p inventory-cli -- verify

cargo run -p incident-cli -- demo
cargo run -p incident-cli -- verify
```

Run the complete Rust baseline with:

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo build --workspace
```

## Authoring Shape

A specification uses only example data and string Event types:

```rust
// features/todos/add_todo/spec.rs
use serde_json::json;
use specter::{CommandScenario, command, event};

let add_todo_spec = command("addTodo")
    .description("Adds a todo to the list.")
    .scenarios(vec![CommandScenario::accepted(
        "Adds the supplied todo.",
        vec![],
        json!({ "todo_id": "todo-1", "title": "Ship it" }),
        vec![event(
            "todo-added",
            json!({ "todo_id": "todo-1", "title": "Ship it" }),
        )],
    )]);
```

An implementation selects Rust types, private state, apply handlers, and the
handler:

```rust,no_run
// features/todos/add_todo/impl.rs
# use serde::{Deserialize, Serialize};
# use specter::{DomainEvent, EventDraft, Result};
# let add_todo_spec = specter::command("addTodo")
#     .description("Adds a todo to the list.")
#     .scenarios(vec![specter::CommandScenario::accepted(
#         "Adds the supplied todo.", vec![], serde_json::json!({"todo_id":"todo-1","title":"Ship it"}),
#         vec![specter::event("todo-added", serde_json::json!({"todo_id":"todo-1","title":"Ship it"}))
#     )]);
#[derive(Deserialize)]
struct AddTodo { todo_id: String, title: String }

#[derive(Serialize, Deserialize)]
struct TodoAdded { todo_id: String, title: String }
impl DomainEvent for TodoAdded { const TYPE: &'static str = "todo-added"; }

let add_todo = add_todo_spec
    .input::<AddTodo>()
    .state()
    .initialized(())
    .handle(|command, ()| async move {
        Ok(vec![EventDraft::new(TodoAdded {
            todo_id: command.todo_id,
            title: command.title,
        })?])
    });
# let _ = add_todo;
# Ok::<(), specter::SpecterError>(())
```

Specifications and implementations can live in separate Rust modules and one
specification can be completed by multiple implementations.

## Remaining 0.3 Gaps

The port now exercises the central 0.3 execution contract end to end, but it
does not yet provide all production adapters and exact behavioral parity:

- pluggable durable Slice Store adapters (Slice state is still embedded in each
  implementation and staged by cloning);
- a public pluggable Reaction Scheduler or durable outbox; the built-in
  scheduler serializes/coalesces in one process;
- selective subscription invalidation by Query/Event dependency (the current
  watch channel invalidates every Query subscription);
- persistence of Reaction delivery metadata across process restarts;
- first-party memory, SQLite, Postgres, outbox, and OpenTelemetry crates;
- runtime schema transformations beyond Serde's lossless decode/encode check;
- a generated-project initializer or Rust application template;
- a network transport or UI client.

Project-owned transport remains deliberate: Specter core accepts envelopes but
does not own HTTP, SSE, WebSocket, or CLI wiring.

See [`REVIEW.md`](./REVIEW.md) for the independent runtime and application
review, including ranked correctness risks and concrete next work.

## Suggested Next Slice

The next useful increment is a `specter-memory` adapter crate that extracts the
in-memory Event Log, Slice Store, and immediate scheduler behind the complete
0.3 adapter contracts. A SQLite adapter and durable Reaction outbox can then
exercise restart recovery and cross-process concurrency.
