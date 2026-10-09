# Handoff — OC++ Session Execution on Specter (`apps/agent-runtime`)

Written 2026-10-09 for the next agent. Read this, then `docs/plans/agent-runtime.md` (the plan, every decision inline) and `docs/notes/agent-runtime-findings.md` (every Specter/OC++ rough edge found, chronological; the decisions there are binding).

## One-paragraph state

OC++'s Session Execution aggregate (inbox → wake → step loop → retries → interrupt → crash recovery → fork/revert → real model + Code Mode) has been rebuilt as a Specter app in `apps/agent-runtime`, spec-first from OC++'s `specs/v2/session.md`. **M1, M2, M3 are complete.** 24 slices, ~386 tests (scenarios + in-process integration + SIGKILL recovery + fake-provider integration), zero app lint warnings, one documented cast. The gated live test passes against a real model (`gpt-5.5` via OpenAI's Codex backend using the OC++ ChatGPT login). **M4 (embed the runtime inside OC++ behind its unchanged `Session` facade) has not started**; its design and facts are below. Everything verified is committed and pushed.

## Repositories, branches, worktrees

| What | Where | State |
|---|---|---|
| Specter (this repo) | `~/specter`, branch `claude/sweet-lovelace-gcz2il` (off `main`) | pushed to `github.com/devagrawal09/specter` |
| OC++ (oracle, package source, M4) | `~/ocpp` (a sibling of `~/specter`), branch `claude/sweet-lovelace-gcz2il` off `main` | pushed to `github.com/devagrawal09/ocpp`; one commit on `main` (codemode type annotation for `tsc`) |
| OC++ `effect-stable` | built on the fork's stale `v2` | superseded by `main`'s own effect 4.0.1 upgrade (devagrawal09/ocpp#5); not merged, kept on the remote as a record |
| OC++ `schema-effect-compat` | `~/opencode-effect-bump` | superseded; safe to delete |
| Saved patches | `~/specter-cleanup-patches/` | all superseded |

**OC++'s trunk is `main`, not `v2`** (corrected 2026-10-09). On the fork, `v2` is a copy of upstream OpenCode last updated 2026-08-31. See the findings entry "OC++ trunk is `main`, not `v2`".

**Critical coupling:** `apps/agent-runtime/package.json` links `@ocpp/schema`, `@ocpp/ai`, `@ocpp/codemode` via `link:../../../ocpp/packages/*`, so an OC++ checkout must sit at `../ocpp` next to this repo. The app follows whatever that checkout has checked out. M4 happens in that same checkout on purpose: when `@ocpp/core` imports the runtime, both sides need one copy of the `@ocpp/*` sources.

## How to run

```sh
cd ~/specter && pnpm install
pnpm --filter @specter/agent-runtime typecheck
pnpm --filter @specter/agent-runtime test            # ~386 tests, 1 gated skip
pnpm check && pnpm lint && pnpm typecheck && pnpm test # whole workspace (verify:starter needs Playwright)
# live test (real model; needs the OC++ ChatGPT login in ~/.local/share/ocpp/ocpp-local.db):
cd apps/agent-runtime && AGENT_RUNTIME_LIVE=1 pnpm exec vitest run src/session.live.test.ts
#   AGENT_RUNTIME_LIVE_MODEL / AGENT_RUNTIME_LIVE_PROVIDER override; default openai/gpt-5.5
```
OC++ checkout: `bun install` needs `BUN_TMPDIR=/tmp/claude/bt BUN_INSTALL_CACHE_DIR=/tmp/claude/bc`; typecheck is `bun turbo typecheck --concurrency=3`; tests run per package (`bun test` inside `packages/<x>`), never from the root. Many OC++ tests need local port binding and a real `rg` on PATH to avoid the ripgrep download.

## App layout (`apps/agent-runtime/src`)

- `events.ts` — 49 Specter event definitions built from `@ocpp/schema` `SessionEvent.DurableDefinitions`; names mapped `.`→`-` (`toSpecterEventType`/`toOcppEventType`); generic `sessionEvent<K>()` lookup (the one cast).
- `features/session/*` — 24 slices: Commands `enqueue-input, cancel-inbox-item, deliver-inbox-item, start-execution, interrupt-execution, record-step-started, record-step-ended, record-step-failed (atomic: + retry-scheduled | execution-failed), finish-execution, record-text, record-tool-call, record-tool-result, fork-session, stage-revert, clear-revert, commit-revert`; Queries `next-deliverable, execution-status, step-status (openCalls, attempts), model-transcript, session-history, revert-status`; Reactions `wake-execution, run-step`. Shared pure fold: `history-fold.ts`.
- `plugins/` — `run-step.ts` (outboxed step plugin: deliver at boundary → model → record text/tool calls → execute Code Mode → results → step end/finish; orphan + aborted-call settlement), `model.ts` (+ `scripted-model.ts`, `ocpp-ai-model.ts` with codex routing), `code-mode-tool.ts`, `delta-channel.ts`, `ocpp-credentials.ts` (read-only reader of OC++'s SQLite credential store; account id from the JWT).
- `app.ts` (memory composition) / `app.jsonl.ts` (persistent); `scenarios.test.ts`, `session.integration.test.ts`, `session.ocpp-ai.integration.test.ts`, `session.recovery.test.ts` (+ `recovery.child.ts`, SIGKILL child), `session.live.test.ts`.
- `vitest.config.ts` `resolve.dedupe: ['effect']` and `single-effect.mjs` keep ONE effect instance despite linked packages carrying their own copy. Required while packages are links.

## Decisions already made (do not reopen without reason)

Standard Schema → `@ocpp/schema` consumed directly · kebab event names, mapped at the boundary · idempotent/no-op Command outcomes modelled as rejections (facade translates back) · Reactions derive requests from state (never from a trigger); one output per commit · fork is a projection, not an Event Log primitive · ephemeral deltas via in-process side channel · failure outcome atomic (one Command emits step-failed + retry|execution-failed) · delivery requires active execution · interrupt settles open tool calls in its own commit · `resume:false` not modelled (no callers in OC++) · M2 done-criterion is event-type sequence + schema validity, not byte-for-byte · M4 = embed in OC++ behind the unchanged facade with a Specter→Bus bridge · full OC++ effect upgrade done now (not deferred) · codex `codexAllowed` table advisory; backend decides · client codegen brands fixed in the generator.

## OC++ effect version

`main` is on effect 4.0.1 (devagrawal09/ocpp#5). The `effect-stable` branch from the first handoff is superseded and gets no PR. Still to do: bump both repos to 4.0.2. OC++'s `minimumReleaseAge` is 3 days, so 4.0.2 can be installed from 2026-10-10 ~17:28Z. Wire note from #5: the SSE stream-failure event name changed, so client and server must ship together.

## M4 — ready to start; facts gathered

- Mount point: `packages/core/src/session.ts` (`Session.Service`, 544 LOC, ~35 ops). It is the only place acquiring `SessionExecution.Service` (l.239) and `SessionInbox.Service` (l.246); server handlers (`packages/server/src/handlers/session.ts`) depend only on `Session.Service`. Ops our runtime covers: `prompt, synthetic, inbox, cancelInbox, steerInbox, queueInbox, interrupt, resume, fork, revert.{stage,clear,commit}, switchAgent, switchModel, rename, wait, active`. Leave to OC++: `list, get, create*, messages, context, environment, view, remove, move, shell, skill, compact, generate, log, background`. (*`create` emits `session.created` — decide whether Specter or OC++ owns it; simplest: OC++ emits, Specter folds it since `session-created` is in our catalog.)
  - **Changed on `main` (5e2cfbbf); re-survey before starting.** The facts above came from `v2`. On `main`, `packages/core/src/session.ts` is 741 LOC and acquires `SessionExecution.Service` (l.300) and `SessionInbox.Service` (l.309). It is no longer the only acquirer: the ID-bound facade `session/session.ts` (523 LOC) acquires both (l.56-57), and `session/execution/restart.ts` acquires `SessionExecution.Service` (l.74). `runner/` gained `stale.ts`, `max-steps.ts` and `prompt/`. Server handlers still depend only on `Session.Service`.
- Errors: facade uses `Schema.TaggedError` classes in `session/error.ts` (`NotFoundError`, `InboxConflictError`, `BusyError`, …). Translation table from our exact rejection strings → these classes is mechanical; our idempotent-retry and idle-interrupt rejections map to OC++'s silent successes.
- Bridge: `Bus.publish(definition, data, { id, commit? })`. **Revised 2026-10-09:** keep the Specter event ID as the Bus event ID; the Bus assigns `seq` itself, because OC++-owned events share the aggregate's sequence space. Replay on startup is idempotent by ID. Ephemeral deltas from `DeltaChannel` go to `Bus` as ephemeral publishes.
- Acceptance harness: OC++'s own `packages/core/test/session-*.test.ts` (create 38, runner 4, plugin 20, wait, owned, revert, …) drive `Session.Service` with `TestLLM`. M4 done = they pass unchanged with the Specter runtime mounted, plus `packages/app` runs a full session with no app/protocol changes, plus `session/inbox.ts, execution.ts, run-coordinator.ts, runner/*` deleted.
- First slice, **revised 2026-10-09:** inbox *and* execution lifecycle, because delivery needs execution facts. See the plan's M4 "Revised first slice". The plumbing is done (link, single Effect, smoke test).
- Dependency law: `@ocpp/core` may depend on `@specter-ts/*` and the runtime app; the app must never import `@ocpp/core` (it imports only `@ocpp/schema`, `@ocpp/ai`, `@ocpp/codemode`).

## Known gaps / small follow-ups

- A running Code Mode tool is not aborted on interrupt (its side effects complete; the result is then rejected as world-moved-on). Needs the outbox worker to expose fiber interruption.
- `codexEligible` in `ocpp-ai-model.ts` has no non-test caller after the advisory change — delete or keep as documentation.
- Projection folds are duplicated per slice by design (AGENTS.md); the history fold was extracted when it reached four copies; the open-call table is now in ~10 slices — a candidate for the same treatment.
- Specter rough edges worth fixing upstream are listed in the findings log: Reaction state-only handlers (document), one-output-per-commit, apply-handler conformance lints too strict, spec payloads unvalidated at `spec:build`, no `createEventDefinitions(map)`, no deterministic outbox drain in tests, outbox handler cannot see prior claims.
- OC++ follow-ups: `codexAllowed` table stale for the `prolite` plan; `RequestExecutor.httpFailure` message ignores Codex `detail` bodies (app works around it).

## Operational gotchas that cost time

- Sub-agent sandboxes block `chatgpt.com` and local ports; run live/port tests from an unsandboxed shell.
- OC++ `bunfig.toml` `minimumReleaseAge` blocks fresh npm releases for 3 days.
- Linked packages: a `link:` dependency's own `node_modules` is found first by Node/TS → two effect copies → `Cannot convert a Symbol value to a string`. Keep `dedupe` + `single-effect.mjs`.
- `git clean` does not remove ignored nested `node_modules`; `bun install` in a worktree recreates them.
- Notebook names in this harness are immutable; server restarts kill running sub-agents but leave their on-disk edits — check `git status` before resuming.