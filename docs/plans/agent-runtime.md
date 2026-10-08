# Plan: OC++ Session Execution on Specter (`apps/agent-runtime`)

Date: 2026-10-08. Status: proposal. Decision owner: dev@codemod.com.

## Goal

Rebuild OC++'s Session Execution aggregate (inbox -> step -> steer/interrupt -> wake -> recovery) as a Specter application, spec-first, until OC++'s existing web app (`packages/app`) runs against it. This dogfoods Specter on a hard real domain, produces the first executable Slice Specifications for OC++ behavior, and decides whether the rest of OC++ core should move to Specter.

It is a new app in the Specter repo, not a change to OC++. OC++ (`~/opencode`, branch `v2`) is the behavioral oracle and the source of reusable packages.

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

### M1 - Semantics with a scripted model (target: 2 weeks)
- Port `specs/v2/session.md` rule groups 1, 2, 3 (admission, delivery order, process-local execution) into Given/When/Then scenarios. Every rule sentence becomes at least one scenario; rejections (`LifecycleConflict`, unknown session, idle interrupt no-op) are exact-reason scenarios.
- Implement slices; `run-step-reaction` driven by a scripted model that returns a fixed sequence of text/tool-call/finish outcomes.
- Done when `pnpm test` passes all scenarios and the three laws below hold in scenario form: (a) steers deliver in enqueue order at the next boundary and never cross a control item; (b) repeated wakes coalesce; (c) interrupt never deletes pending input.

### M2 - Real model and Code Mode (target: +2 weeks)
- Swap in `@ocpp/ai` provider layer and `@ocpp/codemode` as the step plugin's tools; port rule groups 4, 5 (attempts/retry, tool-call durability: each local tool call durable before side effects, outcomes serialized).
- Done when a real provider completes a multi-step session with Code Mode executions, and the `session.tool.*` / `session.codemode.*` events match OC++'s payloads byte-for-byte on a recorded fixture (use `@ocpp/http-recorder`).

### M3 - Crash, restart, fork (target: +2 weeks)
- Kill the process mid-step; on restart the outbox resumes the step and orphan reconciliation fails tool calls still projected as running (rule group 9).
- Implement `session.forked{parentID, boundary}` and revert stage/clear/commit (rule group 9).
- Done when the crash scenario is a scenario-tested, repeatable test, and fork/revert pass their scenarios.

### M4 - Embed the Specter runtime inside OC++ (target: +3 weeks)
- Decided 2026-10-08: OC++ keeps its server, protocol, and UI. The Specter app becomes the implementation behind OC++'s unchanged `session.*` handlers. Work happens in the OC++ repo on a branch off `v2`.
- Mount point: OC++'s ID-bound `Session` facade (`core/src/session/session.ts`, 523 LOC). Its operations (`prompt`, inbox `steer/queue/cancel`, `interrupt`, `fork`, `switchAgent/Model`, `rename`, ...) call the Specter app's `command`/`query`; the 47 HTTP handlers and `packages/app` do not change.
- One event stream: a Specter -> `Bus` bridge forwards session events from `app.subscribe` into `Bus.publish`, using Specter's per-session sequence as the Bus `seq` via the existing `Bus.reserveSequence(aggregateID, seq)` (`seq = max(existing, seq)`) so ordering stays monotonic. SSE feed, projector consumers, and recovery readers are untouched.
- One database: Specter's sqlite adapter (`@specter-ts/sqlite-node`) uses OC++'s existing SQLite file with its own tables.
- Dependency law holds: `@ocpp/core` -> `@specter-ts/core` + the runtime app; the runtime app imports only `@ocpp/schema`, never `@ocpp/core`.
- Done when `packages/app` runs a full session (prompt, stream, tool calls, steer, interrupt, fork) with no app or protocol changes, and `session/inbox.ts`, `execution.ts`, `run-coordinator.ts`, `runner/*`, and the session parts of `projector.ts` (~2.5k LOC) are deleted from OC++ on the branch.

## Specter work this will force (own it as Specter features, not app workarounds)

1. **Fork** — decided 2026-10-08: no Event Log primitive. OC++'s fork is a projection: the `session.forked` projector copies message rows up to the boundary into the child; the child's event log starts at `session.forked{parentID, boundary}`. Mirror that: `fork-session` Command emits the fact; a Reaction materializes the child's history slice from the parent's slice state up to the boundary (rebuildable derived index). Only requirement on Specter: a Reaction/Query may read another aggregate's slice state via `{ query }` — verify in M1.
2. **Step-boundary queries from inside an outboxed plugin**: confirm `{ query }` inside `withReactionOutbox` reads committed state at the boundary without racing the next delivery. Add a scenario harness for outboxed plugins if `@specter-ts/core/testing` lacks one.
3. **Orphan reconciliation hook**: a documented way to run a Reaction once at process start over 'jobs leased by a dead process'. May already fall out of outbox resume; verify, then document in `docs/architecture/plugins.md`.
4. **Event payload schemas** — decided 2026-10-08: Specter validates through Standard Schema (`@standard-schema/spec`), and Effect Schema implements it, so `apps/agent-runtime` imports event definitions from `@ocpp/schema` (pinned commit) directly. No adapter, no Zod port, no Specter change. Verify at M2 that `effect`'s Standard Schema export is identical between OC++'s `4.0.0-rc.112` and Specter's `4.0.1`.
5. **Ephemeral events** — decided 2026-10-08: transport side-channel. OC++ never persists its seven delta/progress events (`text.delta`, `reasoning.delta`, `tool.input.delta`, `tool.progress`, `codemode.progress`, `step.streamed`, `compaction.delta`); `Bus` keeps them in separate PubSubs. Specter `subscribe` coalesces to latest Query State, which is wrong for deltas. So the step plugin publishes deltas to an in-process PubSub service (plain Effect dependency, no Specter change); the M4 bridge forwards them to `Bus` as ephemeral, unchanged.

## Risks

- OC++ `v2` moves daily; pin a commit (current: `e23e7cd2`) for the oracle and fixtures, re-pin per milestone.
- Specter is pre-1.0 with 'no backward compat' policy; the app will break on Specter changes. Acceptable: this app is the reason to change Specter.
- 165k LOC of `app`/`ui` are untouched by design; M4 proves the runtime boundary, not a UI rewrite.
- M4 lives on an OC++ branch that must track a fast-moving `v2`; rebase per week, keep the mount surface (`Session` facade + bridge) small so rebases stay mechanical.
- Double-write window in the bridge: Specter commits, then Bus publishes. A crash between the two must be recoverable by replaying from Specter's log into Bus on startup (idempotent via `reserveSequence`). Scenario-test it in M3's crash harness.
- `effect` version skew between OC++ (`4.0.0-rc.112`) and Specter (`4.0.1`): check at M2 before importing `@ocpp/ai`.

## First tasks (M1, week 1)

1. Hand-scaffold `apps/agent-runtime` (no Vite/Playwright/client; the `create-specter` template is a web app): `package.json` (`@specter/agent-runtime`; scripts `spec:build`, `test` via vitest, `typecheck`), `tsconfig.json` extending the base, `src/features/session/`, `src/events.ts`, `openspec/config.yaml` modeled on `apps/reference/openspec/config.yaml`. Register in root `build`/`test`/`typecheck` filters and `spec:build` export paths.
2. Depend on `@ocpp/schema` — for M1 as `file:../../../opencode/packages/schema` (local link; it has only `effect` + `@standard-schema/spec` as deps and a self-contained `src/`); switch to a git dependency pinned to `e23e7cd2` before M2. Build `src/events.ts` from `SessionEvent.DurableDefinitions` via Standard Schema; no hand-porting.
3. Write `next-deliverable-query/spec.ts` scenarios straight from the delivery paragraphs of `session.md` before any impl.
4. Write `enqueue-input/spec.ts` with the idempotency and type-mismatch rejections.
5. Implement, run, iterate; record which Specter rough edges appear in `docs/notes/agent-runtime-findings.md`.
