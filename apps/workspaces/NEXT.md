# What to build next in Specter Workspaces

The current app is a working local vertical slice, not yet a collaborative
workspace product. These priorities come from the code and tests in this app,
not from an audit of Macro's implementation.

## What exists

- Five command slices and one query connect full-text documents, messages,
  task completion, session selection/drafts, and synthetic text chunks.
- Memory and fsynced JSONL run identical slice contracts. JSONL is a single-writer
  store; clean restart and projection rebuild are covered.
- Typed envelopes, exact idempotent HTTP commands, and latest-state SSE queries
  work. Two active DOM tabs with real SSE exercise stale-draft rejection and
  explicit reload recovery.
- The renamed product is `Specter Workspaces`, in `apps/workspaces`, with package
  `@specter/workspaces`. No core code changed and no new core primitives exist.

## 1. Make editing useful across documents and conflicts

**Build this next for the product.** `setView` currently combines one selected
document and one draft per browser session. Selecting another document resets
that draft. A conflict retains text only in the current DOM; reload/reselection
can discard that local text. There is no revision browser or compare/restore UI.

Give each editor a draft identity, with drafts addressed by document and editor,
and separate selection from draft content. Persist draft content and its source
revision through ordinary slices; model a publication conflict explicitly so
users can compare, copy, or save their branch without destroying either version.
Use the log's existing document revisions for history rather than creating a
second authoritative document store. Keep command decision state private.

Acceptance checks:

- Edit two documents, switch repeatedly, and reload without losing either
  **acknowledged** draft.
- Two editors keep independent drafts; a competing publication rejects without
  overwriting either draft, and compare/restore publishes an intentional result.
- Disconnect after a commit but before its receipt, retry the same request, and
  recover its original outcome. Do not promise offline persistence for input
  that never reached a durable adapter.

This is app state modeling and recovery UI work. It does not justify a document
primitive, CRDT, generic queue, or new core transaction API.

## 2. Attach a real file: the next storage experiment

**Build this next for the thin-core experiment.** Add one small attachment to a
document or message, with name, content type, content hash, download, and an
explicit size limit. Start with a supported JSON-shaped payload and the existing
adapters, so the product path and retry/recovery contract have an executable
baseline before physical storage changes.

Then compare a different adapter encoding against the same logical events and
slice contracts. Measure log bytes, peak memory, append latency, restart/replay,
and download integrity for several file sizes. Decide which durable fact owns
the bytes and ensure a crash cannot acknowledge a link whose bytes are absent.
Do not introduce a second completion marker or orphan-cleanup state machine
before showing why the existing commit boundary cannot own that fact.

Acceptance checks: exact retry returns one attachment, conflicting bytes under
the same key reject, reopen returns the identical hash and bytes, and injected
write failures cannot publish a broken link. Compare JSONL against another real
representation; do not infer physical-storage independence from memory alone.

Core currently fingerprints decoded idempotent command payloads as plain JSON
(`packages/core/src/effect/runtime.ts`). A direct `Uint8Array` command is therefore
a separate boundary to reproduce in an executable test **if the feature needs
that input contract**. Adapter-level encoding of JSON-shaped logical events may
already suffice. Move codec/fingerprint ownership only when a demonstrated
requirement blocks on it and canonical equality, retries, and compatibility of
receipts remain explicit and testable. No special blob API is warranted yet.

## 3. Add actual workspace boundaries and useful navigation

Today the server opens one directory and the query returns every document,
message, task, and session. There is no workspace record, item catalog, search,
rename/archive flow, membership, actor identity, or authorization.

Add workspace identity and item navigation, then rename/archive and a rebuildable
search projection. Define whether a message or task may reference an item in a
different workspace; test that boundary in the deciding command. Before exposing
this server to teammates, add actor/membership authorization and test commands,
queries, SSE activation, and revocation. A local session ID is not an identity
or permission check. Keep the current server loopback-only until this is done.

Do not partition the log just because the product has workspace IDs. First
measure concurrent independent edits, lock wait, p95/p99 command latency,
subscription fan-out, event/projection bytes, and recovery cost with realistic
text sizes. Only introduce separate ordering domains if that workload needs
them, and state what happens to references/transactions across those domains.

## 4. Exercise ephemeral and long-running state separately

- **Presence:** Start with ordinary updates and explicit expiry commands whose
  clock value is supplied at the boundary. Test that a delayed expiry cannot
  erase a renewed session and that restart/replay cannot resurrect expired
  presence. Only then compare an opt-in TTL adapter; make loss, retention, and
  replay guarantees explicit rather than weakening the durable contract silently.
- **Actual AI output:** Replace the synthetic Append demo with one provider-backed,
  cancellable operation. Existing Reaction/plugin/outbox contracts are candidates,
  not wired into this app today. Test duplicate provider delivery, cancellation,
  partial progress, restart, and the final accumulated answer. Latest-state SSE
  is sufficient for a complete current answer; promise individual chunk replay
  only after a cursor/retention delivery contract is implemented and tested.

These are distinct experiments. Neither requires presence or AI-stream concepts
inside core. CRDT merging and distributed delivery should follow an actual
collaboration requirement and measured failure cases, not precede them.

## Verification gate

The 31 scenario/integration/DOM tests remain the current executable baseline.
Two Playwright tests now cover the happy path and the two-tab conflict flow, but
were blocked **before browser startup** by this environment's denied Unix socket
operation. They are typechecked, not passed browser evidence. Run them in an
environment that permits Chromium and local loopback before treating visual or
real-tab behavior as verified. Full repository typecheck and test limitations
remain recorded in the README; the earlier PostHog telemetry denial was not
retried.
