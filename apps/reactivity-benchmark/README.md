# Reactivity benchmark contract

These portable Slice specifications define the observable behavior shared by
the synchronous in-memory Specter runtimes used with
`milomg/js-reactivity-benchmark`.

Until an implementation is added, the contracts live under `src/specs/` rather
than `src/features/`. This keeps the specification-only phase from declaring
incomplete runtime Slices while retaining normal TypeScript formatting and
linting.

They do not define a durable Specter application. The Event sequence is an
in-memory benchmark trace. A settlement buffers its Events and publishes the
whole trace only after every computation and effect callback returns
successfully. Standard persistent Event Logs, retries, restarts, and durable
Reaction delivery are outside this contract.

## Values and equality

Reactive values are portable JSON:

- `null`, strings, booleans, arrays, and plain records
- finite safe numbers other than negative zero
- no `undefined`, `bigint`, functions, class instances, symbols, `NaN`, or
  infinities

Signals and computations compare live values with `Object.is`. Arrays and
records therefore compare by identity, not by shape. The pinned benchmark uses
safe integer signals and number, array, or plain-record computation results.

## Graphs, batches, and ordering

Node, callback, and batch IDs are scoped to one graph. The same ID may be reused
in another graph.

A graph has at most one open batch:

1. The first create or write using a new batch ID opens that batch.
2. Every later mutation uses the same ID until `settleReactiveBatch`.
3. Settlement closes the batch permanently. Its ID cannot be reused.
4. A different ID while a batch is open is rejected.
5. A batch with no pending create or write is rejected.

Nested adapter `withBatch` calls reuse the outer batch ID. They do not open a
second batch. Among ready computations at the same topological depth, callbacks
run in node-creation Event order. Effects run once per batch in their creation
order after all computations settle.

Disposal may discard an open batch. It closes the graph permanently rather than
publishing a batch-settled Event.

## Callback ownership and failure

Each graph owns an ephemeral callback registry. A callback ID identifies one
computation or effect in that graph and may be reused only in another graph.
The adapter registers the callback before the matching create Command.

Conforming benchmark callbacks are synchronous, do not throw, and may only
mutate benchmark-local state such as counters or result arrays. A missing
callback or the deliberately throwing failure fixture aborts settlement without
publishing settlement Events. The adapter discards the graph; it does not retry
the callback.

Disposal releases the graph, its nodes, and its callback registry. Replaying a
trace cannot recreate callbacks and is unsupported. A test harness may replay
Given Events only when it first installs the exact callback fixtures named by
the scenarios. Their required behavior is listed in `CALLBACKS.md`.

## Upstream adapter mapping

The pinned upstream revision is recorded in `upstream.json`.

- `withBuild` opens a graph and one build batch, runs its callback, then settles
  before returning.
- `withBatch` opens one update batch, runs its callback, then settles before
  returning. Nested calls reuse the outer batch.
- `signal`, `computed`, and `effect` outside `withBuild` use one implicit graph
  and settle an implicit batch before returning. This supports the upstream
  framework correctness tests.
- `read()` unwraps an `available` Query result and throws for every other
  status.
- `cleanup()` disposes the active graph and drops its trace and callback
  registry.

All adapter methods are synchronous. An adapter built on the Promise-based
standard Specter App API is not a conforming implementation of this benchmark
contract.
