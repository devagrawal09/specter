# Plan: OC++ Session Execution on Specter (`apps/agent-runtime`)

Date: 2026-10-08. Status: proposal. Decision owner: dev@codemod.com.

## Goal

Rebuild OC++'s Session Execution aggregate (inbox -> step -> steer/interrupt -> wake -> recovery) as a Specter application, spec-first, until OC++'s existing web app (`packages/app`) runs against it. This dogfoods Specter on a hard real domain, produces the first executable Slice Specifications for OC++ behavior, and decides whether the rest of OC++ core should move to Specter.

It is a new app in the Specter repo, not a change to OC++. OC++ (`github.com/devagrawal09/ocpp`, branch `main`, checked out as `../ocpp` next to this repo) is the behavioral oracle and the source of reusable packages. (Until 2026-10-09 this plan said `v2`; on the fork that branch is a stale copy of upstream OpenCode, see the findings log.)

## Findings that shape the plan

- OC++ core already hand-rolls event sourcing: `Bus` (908 LOC) is a per-aggregate Event Log (`EventTable` + `EventSequenceTable`, versioned event types); `session/projector.ts` (872 LOC) folds durable facts into `session_inbox` / `session_external` rows; `Session.prompt` publishes one fact whose projection inserts one row, then wakes execution. This is Specter's Command -> Event -> Slice -> Reaction loop, bespoke.
- `packages/schema` defines ~71 named events, ~45 durable `session.*` events with typed payloads (`inbox.enqueued{item}`, `step.started{assistantMessageID, agent, model, snapshot}`, `step.ended{finish, cost, tokens, files}`, `execution.interrupted`, `forked{parentID, boundary}`, ...). This is the Event Definition vocabulary; reuse the names and payload schemas verbatim.
- The behavior to port is small: `session/inbox.ts` (543), `session/execution.ts` (232), `session/run-coordinator.ts`, `session/runner/*` (step.ts 291) — about 2.5k LOC — and it is already specified in prose in `specs/v2/session.md` (nine rule groups).
- OC++ is Effect 4 (rc.112); Specter is Effect 4.0.1 after the Oct 6 merge. `@ocpp/ai`, `@ocpp/codemode`, `@ocpp/schema` are Effect services and can be consumed as plugin dependencies without modification.
- OC++ protocol: 138 `HttpApiEndpoint`s in 30 groups; the `session` group has 47 and `packages/app` reaches the runtime almost entirely through `sdk.api.session.*` and `sdk.event.on`. Serving `session.*` + the event feed is sufficient to drive the UI; everything else can be proxied to a stock OC++ server.
- Specter already has what the hard part needs: `withReactionOutbox` (leased, restart-resumable, retried, dead-lettered worker) whose plugin receives a typed `{ command, query }` context (#44, #47). A long-lived agent loop becomes one durable step job per safe-step boundary.

## Concept mapping

| OC++ (`specs/v2/session.md`) | Specter |
|---|---|
| Durable `session.*` events in `schema` | Event Definitions (same names, same payloads) |
| `Bus` + `EventTable` keyed by `aggregate_id` | Event Log (sqlite in dev/test, jsonl or postgres later); aggregate = session |
| `projector.ts`, `store.ts`, `session_inbox` rows | Slice State + Query Slices |
| `Session.prompt`, `inbox.steer/queue/cancel`, `interrupt`, `fork`, `switchAgent/Model` | Command Slices |
| Steer-vs-queue delivery order, control-item boundaries | Query Slice `nextDeliverable` (pure fold over events) |
| `SessionExecution.wake`, `SessionRunCoordinator` (coalesced wakes, per-session serialization) | Reaction on `session.inbox.delivered` / `session.step.ended`; Specter's per-slice scheduler gives coalescing and serialization |
| Write-ahead claim surviving crash; orphan reconciliation at drain start | Reaction outbox lease is the claim; outbox resume on restart is reconciliation |
| One Step, several Physical Attempts; `session.retry.scheduled` | Outbox retries; the step plugin emits `retry.scheduled` via `command` |
| Instructions as value deltas; compaction rebuilds history | Query Slices folding `instructions.updated` / `compaction.*` events |
| `session.reasoning.delta`, `codemode.progress` (ephemeral) + SSE feed | Query Subscription (`app.subscribe`); transport stays project-owned |
| `session.forked{boundary}`, `revert.stage/clear/commit` | **Gap.** Specter has no fork/branch-at-sequence primitive. See Specter work below. |

## Architecture of `apps/agent-runtime`

```
apps/agent-runtime/
  src/features/session/
    create-session/            spec.ts impl.ts
    enqueue-input/             (prompt, synthetic, steer, queue; idempotent item IDs)
    cancel-inbox-item/
    change-delivery/
    deliver-next-input/        (reaction: picks per steer/queue law, emits inbox.delivered)
    interrupt-execution/
    select-agent/ select-model/ rename/
    next-deliverable-query/    (pure delivery-order projection; most scenarios live here)
    inbox-query/ history-query/ active-query/ context-query/
    run-step-reaction/         (outboxed plugin: one LLM step per job, checks interrupt/steer at boundary)
    reconcile-orphans-reaction/
    fork-session/              (M3; needs Specter fork primitive)
  src/plugins/
    scripted-model.ts          (M1: deterministic fake provider)
    ocpp-ai-model.ts           (M2: @ocpp/ai)
    ocpp-codemode.ts           (M2: @ocpp/codemode execute)
  src/transport/
    specter-http.server.ts     (dev/test only; M4 has no transport of its own - OC++ hosts the app in-process)
```

Rules: one fact, one owner. The Event Log owns what happened; slice cursors own what has been processed; the outbox lease owns who is running a step. No separate claim table, no separate wake queue.

## Milestones

### M1 - Semantics with a scripted model (target: 2 weeks) — status 2026-10-08: substantially complete in one day
- Landed: 13 slices (enqueue-input, cancel-inbox-item, deliver-inbox-item, start-execution, interrupt-execution, record-step-started, record-step-ended, finish-execution; next-deliverable, execution-status, step-status queries; wake-execution and run-step reactions), ~130 scenarios, an outboxed scripted-model step plugin with a delta side-channel, and three in-process integration cases (two-step run; steer delivered at the boundary; interrupt mid-step preserving pending input). Typed OC++ payloads enforced by the compiler.
- Deferred: `resume: false` — decided 2026-10-08 not to model it: no call site in OC++ source or tests; it exists only as an optional field on three public endpoints. Revisit at M4 only if the facade must keep accepting it (held fact + wake skip, ~half a day). Retries and crash recovery landed later the same day (see M3).
- Port `specs/v2/session.md` rule groups 1, 2, 3 (admission, delivery order, process-local execution) into Given/When/Then scenarios. Every rule sentence becomes at least one scenario; rejections (`LifecycleConflict`, unknown session, idle interrupt no-op) are exact-reason scenarios.
- Implement slices; `run-step-reaction` driven by a scripted model that returns a fixed sequence of text/tool-call/finish outcomes.
- Done when `pnpm test` passes all scenarios and the three laws below hold in scenario form: (a) steers deliver in enqueue order at the next boundary and never cross a control item; (b) repeated wakes coalesce; (c) interrupt never deletes pending input.

### M2 - Real model and Code Mode (target: +2 weeks) — status 2026-10-09: fake-provider path complete; live run pending
- Landed: `Model` service with `ScriptedModel` and `ocpp-ai-model` (`LLM.request`/`LLM.stream`, OC++'s retryability and token mapping, credentials from the OC++ store); Code Mode `execute` tool via `CodeMode.execute` with strict limits; `record-text`, `record-tool-call` (input-started/ended/called in one commit, as OC++), `record-tool-result` slices; transcript fold extended for tool calls/results and corrected against `projector.ts` (retry appends to the attempt's content; text-ended sets the latest block). Six integration cases through the real `@ocpp/ai` code with `TestLLM` reproduce OC++'s event-type sequences (~344 tests).
- **M2 complete 2026-10-09.** Live run passed: `gpt-5.5` via the Codex backend (`chatgpt.com/backend-api/codex`) with the stored ChatGPT login, `chatgpt-account-id` derived from the JWT claim; full session with a Code Mode tool call in 3.1 s; every durable event validated and matched OC++'s event-type sequence. Three diagnoses on the way (API scopes -> codex routing -> account id + model eligibility) are in the findings log.
- Sizing 2026-10-08: `@ocpp/ai` (108 files) and `@ocpp/codemode` (35 files) depend on no other `@ocpp/*` package (dependency law holds) but import `effect/unstable/{http,socket,encoding/Sse}` in 14 + 3 files. Those paths moved to stable names in 4.0.1 and `Socket` changed, so no dual-compatible import exists — unlike `@ocpp/schema`. Consuming the real packages on 4.0.1 requires the full OC++ effect upgrade (the M4 prerequisite), an out-of-process step worker on rc.112, or vendoring. Decided 2026-10-08: do the full OC++ upgrade now (branch `effect-stable`, worktree `~/opencode-effect-upgrade`, opus), targeting 4.0.1 to match Specter; bump both repos to 4.0.2 afterwards as a patch step. The M4 prerequisite is thereby pulled into M2.
- Status 2026-10-09: `effect-stable` verified — 11 commits, typecheck 33/33 (= baseline), per-package tests match baseline (all extra core failures classified environmental: ripgrep download 403, flaky ShellTool), one real regression found and fixed (`u`-flag JSON-Schema patterns), OpenAPI regenerated. Unpushed. Client codegen brands — revised 2026-10-09: fix the generator now on effect-stable (read the brand identifier from the schema wrapper, where 4.0.1 keeps it), regenerate, and verify the generated client is byte-identical to the committed one. `schema-effect-compat` is superseded; the app now links `@ocpp/schema`, `@ocpp/ai`, `@ocpp/codemode` from `~/opencode-effect-upgrade`.
- **Superseded 2026-10-09:** OC++'s trunk is `main`, which already carries its own effect 4.0.1 upgrade (devagrawal09/ocpp#5, merged 2026-10-08). `effect-stable` (built on the fork's stale `v2`) is not merged anywhere. The app now links `../../../ocpp/packages/*`, an OC++ `main` checkout; all 386 tests pass there, and the only change OC++ needed was one type annotation in `@ocpp/codemode` (see findings).
- Swap in `@ocpp/ai` provider layer and `@ocpp/codemode` as the step plugin's tools; port rule groups 4, 5 (attempts/retry, tool-call durability: each local tool call durable before side effects, outcomes serialized).
- Done when (loosened 2026-10-08) a real provider completes a multi-step session with Code Mode executions through the Specter runtime, and the durable events (a) validate against `@ocpp/schema` (enforced by the typed definitions) and (b) form the same event-type sequence OC++ produces for an equivalent interaction, ignoring provider-dependent fields (text, tokens, cost, timestamps, IDs). Verified by a gated live test (skipped without a provider key); `@ocpp/http-recorder` cassettes optional.
- Credentials (decided 2026-10-08, provider-agnostic): the gated live test reads OC++'s own store without `@ocpp/core` — `src/plugins/ocpp-credentials.ts` opens `$XDG_DATA_HOME/ocpp/ocpp-local.db` read-only via `node:sqlite` and decodes rows through `@ocpp/schema` `Credential.Value`. On this machine the store holds `openai` (OAuth) and `typesafe` (key); no Anthropic. OAuth `access` is used as the bearer token; refresh stays OC++'s job; expired -> test skips.
- Design note: OC++ builds the model request in `@ocpp/core` (`toLLMMessages`, `SessionModelRequest`), which the app may not import. Port that as a `model-transcript-query` Query Slice (history -> LLM messages projection, with scenarios); the step plugin reads it at the boundary and calls `@ocpp/ai` `LLM.stream`.

### M3 - Crash, restart, fork (target: +2 weeks) — status 2026-10-08: core done
- Landed: JSONL persistence composition; recovery test with a SIGKILL'd child process (exact resumed sequence asserted; one execution, one delivery); orphan reconciliation in the step plugin; fork-session + session-history-query as a projection (16 + scenarios).
- Revert stage/clear/commit landed later the same day as session facts (history cut is a projection; Snapshot file restoration deferred to tool-call work). The history fold is now duplicated in stage-revert, fork-session, and session-history-query — three copies is the signal to extract one history projection next.
- Deferred: lease-expiry-driven reclaim (JSONL releases dead attempts on open instead; SQLite/Postgres path untested); scenario-level crash harness (process-level only).
- Kill the process mid-step; on restart the outbox resumes the step and orphan reconciliation fails tool calls still projected as running (rule group 9).
- Implement `session.forked{parentID, boundary}` and revert stage/clear/commit (rule group 9).
- Done when the crash scenario is a scenario-tested, repeatable test, and fork/revert pass their scenarios.

### M4 - Embed the Specter runtime inside OC++ (target: +3 weeks)
- Decided 2026-10-08: OC++ keeps its server, protocol, and UI. The Specter app becomes the implementation behind OC++'s unchanged `session.*` handlers. Work happens in the OC++ repo on a branch off `main`.
- Mount point: OC++'s ID-bound `Session` facade (`core/src/session/session.ts`, 523 LOC). Its operations (`prompt`, inbox `steer/queue/cancel`, `interrupt`, `fork`, `switchAgent/Model`, `rename`, ...) call the Specter app's `command`/`query`; the 47 HTTP handlers and `packages/app` do not change.
- One event stream: a Specter -> `Bus` bridge forwards session events from `app.subscribe` into `Bus.publish`, using Specter's per-session sequence as the Bus `seq` via the existing `Bus.reserveSequence(aggregateID, seq)` (`seq = max(existing, seq)`) so ordering stays monotonic. SSE feed, projector consumers, and recovery readers are untouched.
- One database: Specter's sqlite adapter (`@specter-ts/sqlite-node`) uses OC++'s existing SQLite file with its own tables.
- Dependency law holds: `@ocpp/core` -> `@specter-ts/core` + the runtime app; the runtime app imports only `@ocpp/schema`, never `@ocpp/core`.
- Idempotent admission — decided 2026-10-08: Specter scenarios must expect an Event or reject, so a retried inbox item ID (same session, same type) is modelled as a rejection with an exact reason, not OC++'s silent success. The M4 facade translates that rejection back into OC++'s idempotent-success response so the public API is unchanged. Specter's format is unchanged.
- Event names — decided 2026-10-08: Specter's normative spec format requires kebab-case event types, so the app derives its names from OC++'s by `type.replaceAll('.', '-')` (`session.inbox.enqueued` -> `session-inbox-enqueued`) and the bridge inverts the mapping when publishing to `Bus`. Payload schemas stay OC++'s. Specter's rule is unchanged.
- Done when `packages/app` runs a full session (prompt, stream, tool calls, steer, interrupt, fork) with no app or protocol changes, and `session/inbox.ts`, `execution.ts`, `run-coordinator.ts`, `runner/*`, and the session parts of `projector.ts` (~2.5k LOC) are deleted from OC++ on the branch.
- **Status 2026-10-09: plumbing done** (OC++ branch `claude/sweet-lovelace-gcz2il`).
  - `@ocpp/core` depends on `link:@specter/agent-runtime` (run `bun link` in `apps/agent-runtime` once) and imports only its `src/index.ts`.
  - One Effect in the process: a Bun preload plugin re-exports OC++'s copy, and tsconfig `paths` do the same for types.
  - `test/specter-runtime.test.ts` passes, and the 548 `session-*` tests still pass.
  - Superseded by what the code shows: Bun's `link:` names a `bun link` registration, not a path. Bus `seq` cannot be Specter's per-session sequence, because OC++-owned events share the aggregate's sequence space. Bridged events keep their event IDs instead, which also makes startup replay idempotent (`Bus.publish` refuses a duplicate ID).
- **Path chosen 2026-10-09 (maintainer): the runtime runs whole Sessions, one way.** Two other designs were rejected: moving the inbox plus execution lifecycle first (it still splits one aggregate's facts between two owners, and needs copying both ways) and a shared log over OC++'s event table (OC++ does not keep its event history by default).
  - **Ownership.** Behind a switch, the runtime owns every Session Execution fact it records: inbox, execution, steps, text and tools. OC++ owns Session creation and everything else.
  - **Session existence.** The host tells the runtime a Session exists with `register-session`, a boundary Command that takes OC++'s `session.created` payload. The runtime never creates a Session.
  - **Bridge, one way.** `makeEmbeddedSessionRuntime` passes each commit to the host before the Command returns. OC++ publishes it to the Bus with `publishAll`, under the same event IDs and in log order, so `session_inbox`, `session_message`, SSE and the UI are unchanged. Nothing flows back.
  - **Switch.** `SpecterSessions.replacements` in OC++ core swaps `SessionInbox.node` and `SessionExecution.node`. The facade is untouched.
- **Increment 1 done 2026-10-09.** `test/specter-session.test.ts` drives OC++'s `Session.Service` with TestLLM and covers a reply, a Code Mode tool call, an interrupt, and a queued input cancelled mid-step. The default path still passes all 548 `session-*` tests.
- **Gaps, in rough order of next work:**
  1. The model request is the runtime's own: generic system prompt, its transcript, and Code Mode with `echo` only. OC++'s system prompt, instructions and real tools are missing. Next: OC++ provides the step's request and tool execution as services (`SessionContext.prepare` and `prepared.executeTool`). That also gives the model OC++'s history, which today lacks reverts, forks and anything from before a restart.
  2. The runtime's log is in memory, so a restart forgets pending input and running executions. No claims are written, so OC++'s restart recovery skips these Sessions. Next: a persistent Specter store next to `OCPP_DB`, plus replay to the Bus by event ID.
  3. Paths that still write Session Execution facts behind the runtime's back:
     - coalesced synthetic input (`Session.synthetic` with `coalesce` cancels on the Bus);
     - `move`, compaction admission and steer/queue changes (unsupported: they die with a clear message);
     - `revert.commit` on prompt (published by OC++; the runtime's transcript does not see it);
     - the external-agent harness.
  4. A server or app switch (env flag) needs the effect preload in the server process too, and has not been exercised with the real `SpecterSessionModel` (Location model resolution).
  5. Text deltas are not forwarded as ephemeral Bus events yet, so the UI shows text when a step records it, not while it streams.

- **Goal raised 2026-10-09 (maintainer): rewrite all of OC++ on top of Specter.** The work runs in phases.
  - **Phase 1 done: Specter is OC++'s event store.** Specter's Event Log lives in OC++'s SQLite (`specter_event`, `specter_commit`). The Bus records every durable Session fact through the runtime's `recordSessionFacts` Command and projects it (projectors, commit hooks, sequences) inside the same append transaction. This closes gap 2 above: the log persists, and a restart no longer forgets anything.
  - **Two runtimes, one log.** The Bus holds a fact-recording runtime with no Reactions. The runtime that runs Sessions writes to the same log through `bus.specterLog`, and the Bus projects each of its commits as OC++ events in the append transaction and notifies listeners once it commits. Its appends hold the Bus locks of the Sessions they record for, so listeners see each Session's events in order. Registering a Session that the log predates (idempotency key `register:<id>`) is not projected again. Core now re-decides a Command whose own compare-and-swap lost a race to another writer.
  - **Phase 2 done: a consolidated catalog for what the runtime records.** OC++'s structure is not binding. A lifecycle has one started fact and one settled fact with an outcome. When a fact's shape changes, it gets a new name, so one name never carries two shapes. OC++ receives its own events by translation (`core/src/specter/translate.ts`, the only place the two vocabularies meet). The translation goes when OC++'s protocol adopts the catalog.

    | Runtime fact | Replaces (OC++) | Command |
    |---|---|---|
    | `session-execution-settled {outcome}` | execution succeeded / failed / interrupted | `finishExecution`, `interruptExecution`, `settleStep` |
    | `session-step-settled {outcome, retry?}` | step ended / failed, retry scheduled | `settleStep` (was `recordStepEnded` + `recordStepFailed`) |
    | `session-block-recorded {kind, ordinal, text}` | text / reasoning started + ended | `recordBlock` (was `recordText`) |
    | `session-tool-requested {name, input}` | tool input started / ended, tool called | `recordToolCall` |
    | `session-tool-settled {outcome}` | tool success / failed | `settleToolCall` (was `recordToolResult`) |

    Still to do: one `session-status` Query in place of the four status Queries; inbox admission with coalescing, compaction and move items, and delivery changes; compaction and instruction facts.
  - **Phase 3 done 2026-10-09: the runtime drives OC++'s real steps, and OC++'s runner is gone.** Every Session runs on the runtime by default (`AppNodeBuilder` adds `SpecterSessions.replacements` unless a caller replaces the inbox or execution node). `session/runner/llm.ts` and OC++'s run loop are deleted; `SessionExecution.make()` keeps only external-agent Sessions, whose executions the runtime records as `session-external-execution-*` facts and never acts on. All 179 native runner scenarios, and the recorded-cassette and HTTP-hook tests, pass on the runtime.
    - **The runtime orchestrates.** Inbox delivery, the execution lifecycle, steps, the retry budget, recovery and finishing are the step Plugin's (`plugins/run-step.ts`). OC++ supplies the step's I/O through the `StepHost` port (`core/src/specter/step-host.ts`):

      | Hook | What OC++ does |
      |---|---|
      | `begin` (with `attempt`) | Builds the request from OC++'s own context and returns a plan, or asks to compact first |
      | `prepare` | Records instruction changes before input is delivered; a failure fails the execution and leaves the input pending |
      | `moving` | Releases the model transport before a move item is delivered |
      | `compact` | Runs OC++'s compaction; `fatal` when it broke rather than recording its own failure |
      | `recover` | Settles a dead attempt's tool calls from OC++'s records (a delegated child Session) before the runtime settles the rest |

      The attempt records through the recorder: `started`, `streamed`, `block`, `toolRequested`, `toolInputFailed` and `toolSettled`. Its outcome is `succeeded`, `failed` (with `retryable`, `retryDelay`, `fresh` and `limit`), `stopped`, or `interrupted`.
    - **Delivery law, as OC++'s runner and docs state it.**
      - Steers deliver first, in order among themselves; a queued item never holds a steer back.
      - A steered control item is delivered alone.
      - Delivery stops before a control item once input has been delivered.
      - At idle, either the steers or one queued item deliver, never both.
      - An `entry` boundary (a continued turn, or a Session entering a new Location) delivers steers, then the queue's head only when it is a control item.
    - **Executions and wakes.**
      - Held input (`resume: false`) does not wake the Session.
      - An execution takes every wake recorded before it started, as OC++'s run coordinator did. Input it never delivered, when it fails, waits for the next wake; input enqueued while it ran starts the next execution.
      - `sessionStatus.wakes` makes "idle" mean no active execution and no waking input.
      - `interrupt` stops the local attempt so it records what it produced, then settles the in-flight step as aborted. Continuing after an interrupt starts an execution with `continues`.
    - **Retries.** A transparent retry repeats the same step. A fresh retry (the stream continues, or the history was compacted after the step started) runs a new step on the shared budget. OC++'s retry policy (`SessionRunnerRetry`) bounds a step's retries per logical step.
    - **Defects.** A recording failure fails the job, and the outbox retries it (orphan reconciliation covers the step it left in flight). A defect while delivering input would only repeat, so it fails the execution and leaves the input pending.
    - **Intentional differences from OC++'s runner**, recorded in the ported tests:
      - Errors cross the log as `StepFailedError`; a waiter never sees the original defect.
      - A stream that ends without a step finish records `step.unsettled`.
      - A steer cancelled during preparation delivers the queued input at once, with no extra step on unchanged history.
      - A moved Session runs its next input in its new Location; nothing is stranded in the old one.
      - Event lists include the execution lifecycle around each run.
  - **Phase 4 done: nothing about a Session's execution is left outside Specter.**
    - **Every durable fact is in Specter's log.** The Bus now records an external agent's Session facts (`session.external.bound`, `linked` and `checkpointed`) and `worktree.resolved` too. `worktree.resolved` is a project's fact, but it moves the Sessions its directory held to the project. No durable fact bypasses the log.
    - **External agents run on the runtime.** Executions of a Session whose model selects a vendor agent (Claude, Codex, Pi) are woken, started, settled and interrupted by the runtime. The `driveExecution` Reaction requests one outboxed job per such execution; the driver is latched when the execution starts. Its Plugin has the host drive the whole execution through `StepHost.drive`. OC++ drives it with its external agent harness, continuing in a new Location after a move. The step Reaction leaves these executions alone: their steps are the agent's facts.
    - **The runtime owns restart continuity.** It resumes the executions a stopped process left running from its own log, bounded by its retry budget for a step that keeps dying. OC++'s execution claims, its claimed-Session restart sweep and its resume budget are gone, along with the run coordinator and `SessionExecution.make()`. OC++'s restart recovery now covers background work only (shells, Code Mode runs, subagents). When the runtime drives an external agent's execution that the current process did not start, the agent is told the server restarted.
    - **Intentional differences from OC++'s restart recovery.**
      - An OC++-run Session that stopped mid-step retries that step from the same history, so the model gets no restart notice. The dead attempt's partial output does not stand.
      - A turn that keeps dying is bounded by the runtime's per-step retry budget, not by a count of boots.
    - **One status Query.** `sessionStatus` replaces `executionStatus`, `stepStatus` and `nextStep`. It reports a Session's executions, its steps and what its next step starts from, as one fold. The step Plugin reads one snapshot at each boundary instead of several Queries that another commit could land between. `revertStatus` stays separate: a staged revert is the UI's concern, and a part in `sessionStatus` would add it to every status scenario.
    - **The runtime is the only thing that delivers input.** `StepHost.drive` hands the host the runtime's inbox for the execution (what delivers next at a boundary, and delivering an item), so an external agent's turn takes input by the runtime's delivery law and `deliverInboxItem`, as an OC++-run Session's does. OC++'s own promotion moved to a test fixture. OC++'s inbox service stays as the inbox for compositions without the runtime (tests); its facts go to Specter's log like any other.
    - **Read models are projections.** OC++'s read models (`session_message`, `session_inbox` and the rest) are projections of Specter's log, built in the append transaction. Phase 6 brought the rest of OC++'s stored state onto the log.
  - **Phase 5 done: the runtime boots from where it stopped.**
    - **The host keeps the runtime's state.** `makeEmbeddedSessionRuntime` takes `stores`: the Slice stores, and the outbox stores of its two outboxed Reactions. `makeSnapshotSliceStores` gives in-memory Slice stores that start from saved snapshots (a Slice's state and cursor) and take new ones. The Bus's event store takes Slice stores the same way.
    - **OC++ keeps it in its database.**
      - `specter_slice_snapshot` holds one row per Slice. It is saved every minute, and once more after the runtime has closed. A save never replaces a later cursor: the Bus and the runtime fold `recordSessionFacts` alike, so either one's snapshot is valid.
      - `specter_outbox_job` holds both Reactions' jobs, keyed by Reaction and delivery. Each Session runs one job at a time.
    - **A boot does work in proportion to what changed.** Each Slice folds only the log after its cursor. A delivery replayed because its Slice's snapshot is older finds its job and does not run again. Completed jobs older than a day are pruned at boot.
    - **Opening an outbox requeues what the last process left unfinished.** Running and dead-lettered jobs get a fresh retry budget, as replaying them into an empty outbox did. Their attempts died with the process, so waiting out their leases would only delay their Sessions.
    - **Losing the snapshots costs time, not correctness.** Without them, a boot folds the whole log as it did before.
  - **Phase 6 done: OC++'s stored state is projections of Specter's log.**
    - **One manifest.** OC++'s durable event manifest lists every fact it records. The Bus records each one through the runtime, and the runtime's catalog is that manifest, so a new fact is one entry.
    - **Every change is a fact.** These each publish internal durable facts instead of writing their rows:
      - project records, worktrees and workspaces;
      - API instruction entries;
      - Code Mode: executions, their call journal, the notebook, slash commands and scheduled events;
      - credentials;
      - background job markers;
      - an imported Session's history, and the instruction values an update refers to by hash.

      Their rows are projections written in the transaction that records the fact. Internal facts stay out of the client-facing manifest; clients keep their usual notifications.
    - **Decisions.** A decision that reads state before recording is serialized per key (project, workspace, credential integration, Session). One that must be atomic with concurrent facts is made by the projection: whether a finished Code Mode program's declarations save, which a revert can race.
    - **Aggregates.** A Code Mode execution and a background job marker are aggregates of their own. Journaling a program's calls does not advance its Session's sequence, and a marker can be recorded from a Session listener, which holds that Session's lock.
    - **What Phase 6 left outside the log:** credential secrets, the key-value store, the runtime's outbox and Slice snapshots, and legacy tables. Phase 7 settled each of them.
  - **Phase 7 done: nothing OC++ stores is kept off the log by design.**
    - **Credential secrets are on the log, sealed.** A credential's created and rotated facts carry its secret, encrypted with AES-GCM under a key of that credential. The key is the one thing kept beside the log. The publish of the creation writes it, in the same transaction, and it is deleted with the credential. That leaves every sealed copy of the secret unreadable, in the log or any copy of it (crypto-shredding). A migration seals the secrets already stored.
    - **The key-value store is facts.** Plugin storage, the web search provider and the known well-known origins publish `kv.stored` and `kv.removed`; `kv` is their projection.
    - **Caches are not state.** The models.dev catalog and repository refresh times moved to a `cache` table. Its entries can be dropped at any time and are refetched, so they are not facts.
    - **The runtime's own state is derived.** Its outbox and Slice snapshots only save work. A test deletes both between boots: the next boot rebuilds them from the log, and the Session carries on.
    - **Legacy tables are gone.** `account`, `account_state`, `control_account`, `session_pending` and `project_directory` were dropped, since no code read or wrote them.
  - **Phase 8 done: one copy of every event.**
    - **OC++'s event table is an index, not a store.** The Bus used to keep a second copy of every durable event, with its payload, when configured to persist (the workerd server was). `Bus.log`, and with it the Session log endpoint, read only that copy, so a server without it served an empty history. The `event` table now holds each event's aggregate sequence and the fact in Specter's log it is, written for every fact. Log reads translate the facts on the way out. The `persist` option is gone, and every server serves Session logs.
    - **Replaying events from another server is gone.** `Bus.replay`, `Bus.claim` and replay owners had no callers. `Bus.rebuild(aggregate)` projects an aggregate's events again from Specter's log; tests use it to show that read models are projections of the log.
    - **The Bus records only the inventory.** A durable event outside OC++'s inventory of recorded facts is refused, instead of taking the old path into OC++'s own table.
    - **Stored history moved into the log.** A migration archives the events a persisting server kept, under their versioned OC++ type, one commit per aggregate. The runtime does not read those types, and log reads decode them as they were.
    - **Usage statistics read the log.** Compaction usage is counted from the facts. The old query compared an unversioned type with the stored versioned one, so it had never counted any.

  - **Phase 9 done: every row OC++ stores is a projection of Specter's log.**
    - **Rebuilding from the log alone reproduces every read model.** `Bus.rebuild()` projects the whole log again, in the order it was recorded. A test runs a Session through a Code Mode program, a credential and plugin state, wipes every table OC++ projects, rebuilds, and requires the same rows. The only tables it leaves out are Specter's own, the event index, the migration record, caches and credential keys.
    - **Projections no longer read the clock.** The test found updates that took `time_updated` from `Date.now()`, through the shared timestamp columns' update hook. Updates now change it only when they set it, and projections set it from their fact.
    - **Rows without a fact are adopted.** `rows.adopted` records an aggregate's rows in one projected table as they are stored, and its projection makes the table hold exactly those rows.
      - A migration adopts everything a database holds when it upgrades, which is the state the log predates.
      - The v1 importer adopts each Session it converts, and its own progress, before moving on.
      - A test upgrades a database that held its project, Session, messages and plugin state as rows, rebuilds every projection from the log, and the Session carries on.

  - **Phase 10 done: the runtime's saved state is the log's, and every suite passes.**
    - **A boot can catch every Slice up.** `makeSpecterRuntime(config, { catchUp: "all" })` catches every Command and Query Slice up to the log at startup, as an eager Slice is; Reactions always do. The embedded runtime's `catchUp` option uses it, and OC++ turns it on: from saved snapshots, a boot only folds the log's tail.
    - **Saved runtime state equals a fold of the log.** Slice snapshots and outbox jobs exist only to save work.
      - A Specter test runs a Session, saves its Slices, and boots twice more: once from the snapshots and once from the log alone. Both hold every Slice with the same cursor and state, and neither records a fact.
      - The same test runs in OC++ over its database. After the runtime's tables are wiped, a boot from the log saves the same snapshots for every Slice that a boot from snapshots saves. It records nothing and leaves no pending job: the outbox holds only work the log still asks for.
    - **Every test failure is gone.** The baseline failures were upstream test drift:
      - an SDK test still expected a direct `shell` tool, which the model now reaches through Code Mode;
      - client tests still expected authentication and Code Mode's old `output` field, both removed upstream;
      - a server helper failed on hosts without IPv6.

      The two lock-permission tests fail only as root, as their premise is a directory root can still write. They pass as an ordinary user.

  - **What "all of OC++" covers, and what else the monorepo holds.**
    - **The OC++ agent is on Specter.** Its product state is all in core's database, as Specter's log and its projections. That covers Sessions, projects, worktrees, workspaces, credentials, plugin state, Code Mode and background jobs, and every projection rebuilds from the log. The server reads projections and writes nothing of its own. The CLI's `auth` commands go through the server API. The workerd profile runs the same core database on Durable Object storage. The client and the `app` UI reach product data only through the server API; `app` keeps browser UI state (layout, tabs, drafts) in localStorage and IndexedDB. The CLI writes its own config and service registration files.
    - **Other services in the monorepo are separate products, inherited from upstream.** They deploy on their own through `sst.config.ts` and `infra/*.ts`, or their own wrangler config, each with its own store:
      - the Zen/console SaaS (`packages/console/*`): PlanetScale MySQL for accounts, workspaces, keys, billing and usage, plus Stripe, Upstash Redis and Cloudflare KV for auth;
      - the stats site (`packages/stats/*`): its own PlanetScale database and an AWS data lake;
      - the update registry (`packages/updates`): Cloudflare D1;
      - two share backends: `packages/enterprise` (R2 or S3 objects) and `packages/function` (Durable Objects and R2). No OC++ code calls either;
      - the static sites `www`, `posts` and `web`.

      None of them reads or writes through OC++ core. The owner decided the rewrite's scope is the agent. These services stay in the repo as candidates for later experiments: how well other production services move onto Specter.
    - **Verification in this container.** Every package typechecks except `app` and `enterprise`, whose dependencies (`ghostty-web` from GitHub, `@solidjs/start` from pkg.pr.new) the network policy blocks. With those two modules stubbed, the only errors left come from their types. The lock tests now make their root unwritable for root as well, by marking it immutable, so the core suite passes as root.

## Specter work this will force (own it as Specter features, not app workarounds)

1. **Fork** — decided 2026-10-08: no Event Log primitive. OC++'s fork is a projection: the `session.forked` projector copies message rows up to the boundary into the child; the child's event log starts at `session.forked{parentID, boundary}`. Mirror that: `fork-session` Command emits the fact; a Reaction materializes the child's history slice from the parent's slice state up to the boundary (rebuildable derived index). Only requirement on Specter: a Reaction/Query may read another aggregate's slice state via `{ query }` — verify in M1.
2. **Step-boundary queries from inside an outboxed plugin**: confirm `{ query }` inside `withReactionOutbox` reads committed state at the boundary without racing the next delivery. Add a scenario harness for outboxed plugins if `@specter-ts/core/testing` lacks one.
3. **Orphan reconciliation hook**: a documented way to run a Reaction once at process start over 'jobs leased by a dead process'. May already fall out of outbox resume; verify, then document in `docs/architecture/plugins.md`.
4. **Event payload schemas** — decided 2026-10-08: Specter validates through Standard Schema (`@standard-schema/spec`), and Effect Schema implements it, so `apps/agent-runtime` imports event definitions from `@ocpp/schema` (pinned commit) directly. No adapter, no Zod port, no Specter change. Verify at M2 that `effect`'s Standard Schema export is identical between OC++'s `4.0.0-rc.112` and Specter's `4.0.1`.
5. **Ephemeral events** — decided 2026-10-08: transport side-channel. OC++ never persists its delta/progress events (`text.delta`, `reasoning.delta`, `tool.input.delta`, `tool.progress`, `codemode.progress`, `compaction.delta`); `Bus` keeps them in separate PubSubs. (`step.streamed` has since become durable in OC++: the runtime records it as `session-step-streamed`.) Specter `subscribe` coalesces to latest Query State, which is wrong for deltas. So the step plugin publishes deltas to an in-process PubSub service (plain Effect dependency, no Specter change); the M4 bridge forwards them to `Bus` as ephemeral, unchanged.

## Risks

- OC++ `main` moves daily; pin a commit (current: `5e2cfbbf`) for the oracle and fixtures, re-pin per milestone.
- Specter is pre-1.0 with 'no backward compat' policy; the app will break on Specter changes. Acceptable: this app is the reason to change Specter.
- 165k LOC of `app`/`ui` are untouched by design; M4 proves the runtime boundary, not a UI rewrite.
- M4 lives on an OC++ branch that must track a fast-moving `main`; rebase per week, keep the mount surface (`Session` facade + bridge) small so rebases stay mechanical.
- Double-write window in the bridge: Specter commits, then Bus publishes. A crash between the two must be recoverable by replaying from Specter's log into Bus on startup (idempotent via `reserveSequence`). Scenario-test it in M3's crash harness.
- `effect` version skew between OC++ (`4.0.0-rc.112`) and Specter (`4.0.1`): resolved for `@ocpp/schema` by the OC++ branch `schema-effect-compat` (dual-compatible). Importing `@ocpp/ai`/`@ocpp/codemode` at M2 and embedding at M4 require OC++ on stable effect — file "upgrade to effect 4.0.2" in OC++ as an M4 prerequisite (it is a real migration: `effect/unstable/*` paths, `Socket` redesign, CLI renames).

## First tasks (M1, week 1)

1. Hand-scaffold `apps/agent-runtime` (no Vite/Playwright/client; the `create-specter` template is a web app): `package.json` (`@specter/agent-runtime`; scripts `spec:build`, `test` via vitest, `typecheck`), `tsconfig.json` extending the base, `src/features/session/`, `src/events.ts`, `openspec/config.yaml` modeled on `apps/reference/openspec/config.yaml`. Register in root `build`/`test`/`typecheck` filters and `spec:build` export paths.
2. Depend on `@ocpp/schema` — for M1 as `file:../../../opencode/packages/schema` (local link; it has only `effect` + `@standard-schema/spec` as deps and a self-contained `src/`); switch to a git dependency pinned to `e23e7cd2` before M2. Build `src/events.ts` from `SessionEvent.DurableDefinitions` via Standard Schema; no hand-porting.
3. Write `next-deliverable-query/spec.ts` scenarios straight from the delivery paragraphs of `session.md` before any impl.
4. Write `enqueue-input/spec.ts` with the idempotency and type-mismatch rejections.
5. Implement, run, iterate; record which Specter rough edges appear in `docs/notes/agent-runtime-findings.md`.
