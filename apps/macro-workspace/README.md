# Macro-style workspace experiment

A working, local document → message → task workspace built entirely with existing
Specter slices and adapters. This is a prototype, not a Macro clone. No Macro
source, assets, or dependencies were copied.

## Run

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build:publishable
pnpm --filter @specter/macro-workspace dev
```

Open **http://127.0.0.1:41732**. The fixed port fails if occupied. This is a local
single-user server; it binds loopback, checks Host and Origin, and has no account
or permission system. Do not expose it as a hosted application.

1. Create a document, type in its session draft, and publish a revision.
2. Post a linked message and create a task from that message.
3. Toggle the task and use **Append demo** to append two synthetic text chunks.
4. Reload or restart the server: accepted content, document selection, draft,
   and draft source revision return from `data/workspace`.

The same browser profile shares one session ID across tabs. Separate profiles
have independent drafts. Selecting a document starts a draft from its published
body; this prototype retains one selected draft per session, not a draft for
every document. Clicking a document again deliberately resets that draft.

## Actual state ownership

| Slice | Owns | Guard |
| --- | --- | --- |
| `saveDocument` | Full document text and revision | Document-local expected revision |
| `postMessage` | Message text and document link | Existing document; unique message ID |
| `setTask` | Task text, completion, message link, revision | Existing message; task-local expected revision |
| `setView` | Session selection, editor draft, source document revision | Existing document; session-local expected revision |
| `appendMessage` | Each accepted text chunk | Exact UTF-16 text offset |
| `workspace` | Disposable accumulated read model | Replay of all five event types |

Each command owns a private decision projection. The query is never consulted
by command handlers. IDs originate at the client boundary. The event log is the
only authoritative content store; there is no parallel document store or stream
buffer. Slice files are disposable `{ state, cursor }` projections. The adapter
selects memory or fsynced JSONL in `src/app.ts`; slice logic and specifications
are identical in both modes.

The client persists every editor `input` event, including the complete draft,
as an ordinary `setView` command. DOM state is a disposable read cache. Pending
network work and browser focus, selection, scroll position, message-composer text,
and the local session identifier still live in the browser. Unacknowledged input
can be lost on close. This does **not** establish ownership of every physical
application state transition. It establishes a concrete path for several kinds
of content and session state through the same programming model.

A draft remembers its source document revision. Publishing uses that revision,
so intervening publication causes a conflict instead of silently overwriting
someone else's work. Publication and updating the session's source revision are
two commands, not a cross-slice transaction. A failure between them can leave a
stale draft that needs explicit reselection; it cannot silently overwrite a newer
document revision. The editor keeps its displayed draft, source document revision, and last
acknowledged session revision together. Remote snapshots cannot advance these
revisions while the editor is focused, dirty, saving, or conflicted. A stale tab
therefore rejects its next session write rather than rebasing old text onto a
newer revision. Conflicts retain local text and disable publication; selecting
the document explicitly reloads text and revisions together. An idle, unfocused
editor can adopt a complete newer snapshot.

## What the experiment establishes

- **Concurrency:** On memory and JSONL, two commands editing the same document
  revision produce one success and one rejection. An unrelated document retains
  its own revision. This uses existing adapter command transactions and one
  global event order; it does not demonstrate partitioned or distributed writes.
- **Persistence:** Clean close/reopen restores content and draft. Deleting all
  projection files and reopening reconstructs the same state from the log. A
  second JSONL writer is refused. Both log and projection fsync are enabled.
  The prototype adds no power-failure or process-kill test; existing JSONL tests
  cover adapter recovery independently.
- **Subscriptions:** Two independent subscribers receive initial state and
  accumulated text. Slow consumers may skip intermediate query snapshots while
  retaining the final text. HTTP/SSE disconnect cancels the subscription. The
  transport honors backpressure, allowlists commands, validates payloads through
  slice schemas, and requires exact idempotency keys. Reconnecting starts from
  current state; there is no SSE event-ID replay protocol.
- **Retries:** Repeating an exact request returns the original commit. A changed
  payload with the same key conflicts. Chunk offsets independently prevent a
  duplicate append under a different key. A network retry in the client reuses
  the same key. A caller still needs its own recovery policy after unresolved
  network failures; this is not an offline queue.

## Core assumptions and the smaller-core question

**No core APIs or implementation changed.** This slice required no document,
stream, presence, or blob primitive and no new adapter abstraction. Existing
execution and storage seams already support the demonstrated behavior.

Concrete boundaries exposed by this implementation:

1. The log still supplies one total order and one command-serialization domain.
   Document-local revisions avoid *application* conflicts caused by unrelated
   edits, but do not remove contention in the physical log. A partition contract
   would need evidence from an actual multiwriter workload and a precise answer
   for a message or task linking across partitions; this experiment supplies
   neither.
2. Small physical transitions are valid ordinary events, but retaining them all
   has visible storage cost. JSONL indexes the complete history in memory, and
   both log growth and full-state projection writes need separate evaluation
   for sustained editing. No retention, compaction, TTL, or snapshot contract was
   invented here.
3. Latest-state subscriptions can represent complete streamed output when the
   query accumulates chunks. They do not promise delivery of every chunk. A
   lossless stream adapter would need a tested cursor/retention contract rather
   than being substituted silently.
4. The chosen adapters serialize JSON. Separately, source inspection of
   `packages/core/src/effect/runtime.ts` (`fingerprintCommand` / `canonicalize`)
   confirms that any command with an idempotency key is fingerprinted in core,
   where non-plain objects such as `Uint8Array` are rejected. Merely replacing
   the storage adapter therefore cannot make retryable binary commands work.
   That is a concrete candidate boundary for a future binary-state experiment,
   not a binary capability demonstrated by this slice. Changing fingerprint
   ownership without a tested equality/retry contract would weaken guarantees,
   so it remains unchanged.

Presence expiry, actual AI generation, CRDT convergence, binary attachments,
permissions, deletion, distributed subscriptions, and cross-log transactions
are outside this first slice. The next experiment should select one of these
requirements and test its failure model before changing a core contract.

## Measurements

Run `pnpm --filter @specter/macro-workspace measure`. It makes 100 sequential
one-character chunk commits with exact idempotency and a full accumulated query
after each, following a document and message creation. There are no subscribers
or simulated network latency in this diagnostic. It uses a temporary directory
and removes it after completion.

One run in the development container (Node 24.22.1, fsynced JSONL):

| Adapter | 100 commits + queries | Median | p95 | Log bytes | Projection bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Memory | 84 ms | 0.52 ms | 4.15 ms | — | — |
| JSONL | 77 ms | 0.66 ms | 1.32 ms | 36,881 | 419 |

Final streamed text was 100 ASCII bytes. JSONL clean reopen plus query took
1.42 ms; deleting the projections then rebuilding the query took 1.52 ms. These
are small, warm, local observations, not throughput or durability guarantees and
not evidence that JSONL is faster than memory. Log bytes include creation,
metadata, IDs, and retry fingerprints; projection bytes are the final disk
footprint, not cumulative write volume. The diagnostic exposes overhead but does
not characterize real collaborative editing or storage hardware.

## Verification

- `pnpm --filter @specter/macro-workspace test`: **31 passing tests** covering
  executable scenarios, both adapters, competing edits, retry conflicts,
  subscriptions, restart/rebuild, HTTP/SSE, and the shipped UI script in a DOM
  simulation using real HTTP commands. A two-tab regression test also uses two
  live HTTP/SSE subscriptions with an EventSource compatibility shim to verify
  stale-text rejection, retained text, disabled publication, and explicit reload
  recovery. It failed against the original client before the fix.
- `pnpm --filter @specter/macro-workspace typecheck`: passes.
- Existing core, memory, and JSONL tests: **176 passing tests** (70 + 9 + 97).
- Repository `pnpm check`, `pnpm lint`, and `pnpm build`: pass. Existing lint
  warnings remain in unrelated code.
- Full repository `pnpm typecheck`: blocked by pre-existing missing local
  `@ocpp/schema`, `@ocpp/ai`, and `@ocpp/codemode` links in agent-runtime.
- Full repository `pnpm test`: stopped by automatic approval review after its
  codemod step triggered telemetry to an untrusted PostHog destination. The full
  baseline did not finish and was not retried.
- Real-browser visual verification: attempted, but the cloud browser could not
  reach the local preview (`ERR_CONNECTION_REFUSED`). The DOM test is explicitly
  not a real-browser test.

The draft PR must retain these limitations until the full baseline and a real
browser check can be completed. Nothing is merged or deployed.
