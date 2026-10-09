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
  - **Phase 2 in progress: a consolidated catalog for what the runtime records.** OC++'s structure is not binding. A lifecycle has one started fact and one settled fact with an outcome. When a fact's shape changes, it gets a new name, so one name never carries two shapes. OC++ receives its own events by translation (`core/src/specter/translate.ts`, the only place the two vocabularies meet). The translation goes when OC++'s protocol adopts the catalog.

    | Runtime fact | Replaces (OC++) | Command |
    |---|---|---|
    | `session-execution-settled {outcome}` | execution succeeded / failed / interrupted | `finishExecution`, `interruptExecution`, `settleStep` |
    | `session-step-settled {outcome, retry?}` | step ended / failed, retry scheduled | `settleStep` (was `recordStepEnded` + `recordStepFailed`) |
    | `session-block-recorded {kind, ordinal, text}` | text / reasoning started + ended | `recordBlock` (was `recordText`) |
    | `session-tool-requested {name, input}` | tool input started / ended, tool called | `recordToolCall` |
    | `session-tool-settled {outcome}` | tool success / failed | `settleToolCall` (was `recordToolResult`) |

    Still to do: one `session-status` Query in place of the four status Queries; inbox admission with coalescing, compaction and move items, and delivery changes; compaction and instruction facts.
  - **Phase 3 next: the runtime drives OC++'s real steps.** The runtime keeps orchestration: inbox delivery, the execution lifecycle, steps, the retry budget, recovery and finishing. OC++ supplies the step's I/O as a host service: it builds the request from OC++'s own context (`SessionContext.select/load/prepare`: system prompt, instructions, agent, tools), streams the model, executes tools, and captures snapshots. The service records what the attempt produces through a recorder the step Plugin hands it (`recordBlock`, `recordToolCall`, `settleToolCall`), and returns the outcome that `settleStep` records. OC++'s message tables are projected from the runtime's facts in the same transaction, so OC++'s request building already sees the runtime's history. After that, the runner, inbox, execution and run coordinator in OC++ are deleted.

## Specter work this will force (own it as Specter features, not app workarounds)

1. **Fork** — decided 2026-10-08: no Event Log primitive. OC++'s fork is a projection: the `session.forked` projector copies message rows up to the boundary into the child; the child's event log starts at `session.forked{parentID, boundary}`. Mirror that: `fork-session` Command emits the fact; a Reaction materializes the child's history slice from the parent's slice state up to the boundary (rebuildable derived index). Only requirement on Specter: a Reaction/Query may read another aggregate's slice state via `{ query }` — verify in M1.
2. **Step-boundary queries from inside an outboxed plugin**: confirm `{ query }` inside `withReactionOutbox` reads committed state at the boundary without racing the next delivery. Add a scenario harness for outboxed plugins if `@specter-ts/core/testing` lacks one.
3. **Orphan reconciliation hook**: a documented way to run a Reaction once at process start over 'jobs leased by a dead process'. May already fall out of outbox resume; verify, then document in `docs/architecture/plugins.md`.
4. **Event payload schemas** — decided 2026-10-08: Specter validates through Standard Schema (`@standard-schema/spec`), and Effect Schema implements it, so `apps/agent-runtime` imports event definitions from `@ocpp/schema` (pinned commit) directly. No adapter, no Zod port, no Specter change. Verify at M2 that `effect`'s Standard Schema export is identical between OC++'s `4.0.0-rc.112` and Specter's `4.0.1`.
5. **Ephemeral events** — decided 2026-10-08: transport side-channel. OC++ never persists its seven delta/progress events (`text.delta`, `reasoning.delta`, `tool.input.delta`, `tool.progress`, `codemode.progress`, `step.streamed`, `compaction.delta`); `Bus` keeps them in separate PubSubs. Specter `subscribe` coalesces to latest Query State, which is wrong for deltas. So the step plugin publishes deltas to an in-process PubSub service (plain Effect dependency, no Specter change); the M4 bridge forwards them to `Bus` as ephemeral, unchanged.

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
