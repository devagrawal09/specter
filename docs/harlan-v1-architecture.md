# Harlan v1 Architecture

## Goal

Harlan v1 is a portable language for dynamically composing task-specific tools
into saved, reusable workflows. The reference product lives in `apps/harlan` in
the Specter monorepo, while the language and execution runtime remain usable
without Specter, a filesystem, a VM, a container, or a sandbox.

This is a focused v1. It does not migrate legacy Harlan sessions, scripts, CLI
behavior, or UI behavior.

This change contains the architecture contract and a browser-only workspace
scaffold. The implementation phases below are future, separately reviewed
changes. The scaffold contains no language, persistence, transport, LLM, or
Specter Slice behavior.

## Product decisions

1. The reference implementation is a new Specter monorepo app at
   `apps/harlan`.
2. The Specter Event Log is the app's sole durable **domain** truth. Workflow
   source, immutable revisions, resolved execution plans, execution inputs,
   operation requests and approval decisions, operation outcomes or explicit
   uncertain states, and final results are Events. Catalogs, timelines, and
   other domain indexes are rebuildable projections. Reaction cursors, outbox
   jobs, and provider receipts are separate operational facts with the owners
   defined below.
3. An authoring LLM turns requests into Harlan source and can revise invalid
   scripts. Tests use a fake provider. A separate, manual final smoke test may
   use one pinned, inexpensive model through OpenRouter under the explicit
   opt-in and data-egress rules below.
4. The host-neutral language is an expression core with literals, records,
   lists, immutable `let` bindings, member access, calls, pipelines,
   conditionals, Boolean and comparison operators, and bounded sequential
   `for`. V1 has no user-defined functions; saved workflows provide reuse.
5. Harlan has no ambient filesystem, shell, process, environment, clock,
   randomness, or network authority. A host supplies only explicit,
   task-specific tools.

## Boundaries

The language runtime owns parsing, evaluation, deterministic data flow,
structured errors, resource limits, and yielding unresolved tool operations.
It accepts source, JSON input, tool definitions, workflow definitions, and
previously recorded operation results. It returns a completed value, a
structured failure, or the next unresolved operation. It does not import
Specter or perform external work directly.

The host SDK owns tool and workflow registries, immutable tool and workflow
definition revisions, alias resolution, workflow-as-tool composition, and an
in-memory reference host. The reference host proves that Harlan can execute and
reuse workflows without Specter or environmental capabilities.

The Specter host owns the durable domain lifecycle, authorization, approvals,
causal history, and resumption. Its adapters own operational delivery
guarantees:

- The Event Log owns requested operations, approval decisions, terminal
  outcomes, and explicit uncertain outcomes.
- Each Reaction Slice cursor owns which Event Log commits that Reaction has
  completed.
- A durable outbox owns remote delivery jobs, leases, attempts, retry timing,
  dead letters, and local delivery completion. Enqueue and Reaction cursor
  advancement must be atomic.
- The remote provider owns its receipt and actual remote result. Provider
  idempotency or status lookup is authoritative when available.
- The scheduler only wakes and coordinates processing. Its state is rebuildable
  from the Event Log, Reaction cursors, and outbox jobs.

Every external tool call crosses Specter Command and Reaction boundaries:

```text
request workflow execution
  -> evaluate until an unresolved operation
  -> append an operation-requested Event with exact identity and fingerprint
  -> append an approval decision when policy requires it
  -> tool Reaction atomically enqueues a delivery under its stable delivery ID
  -> outbox worker invokes the adapter with the stable operation ID
  -> append an operation-succeeded, operation-failed, or operation-uncertain Event
  -> reevaluate with recorded outcomes
  -> complete or yield the next operation
```

Fast, local, idempotent capabilities may use a direct Reaction Plugin. Remote or
slow tools use the durable outbox. Local outbox deduplication uses the stable
Reaction `deliveryId`; the adapter receives the persisted operation ID as its
retry-stable provider idempotency key.

Remote delivery remains at least once. If an attempt may have reached a provider
but no outcome was recorded, the worker first reconciles through provider
idempotency or status lookup. When neither exists, it records
`operation-uncertain` and stops automatic retry so a person or tool-specific
reconciliation policy can decide what happens next. Approval is bound to the
exact operation fingerprint, so changed arguments, tool revisions, or effect
metadata require a new approval.

Pure language evaluation does not emit commands. On resumption the runtime
replays deterministically from the beginning rather than serializing an
interpreter continuation. It never consumes an operation result by position
alone.

Before execution, the host resolves the top-level workflow and every transitive
workflow alias to an immutable revision. The execution records that full
revision graph, the language/conformance version, and the immutable tool
definition revisions it may call. Each yielded operation has:

- an execution-scoped stable operation ID and call path;
- the resolved tool or workflow definition revision;
- canonical argument and operation fingerprints;
- the input/output schema versions and effect-policy version.

On replay, the next yielded operation must exactly match the recorded call path,
revision, arguments, schemas, and effect policy before the runtime supplies its
recorded result. A mismatch is a structured replay failure and no external work
runs. Canonical JSON encoding and digest algorithms are part of the versioned
language contract.

Saved workflows are immutable, content-addressed artifacts and are exposed to
Harlan through the same call interface as native tools. Mutable aliases may
point to immutable revisions, but an execution records the complete resolved
revision graph before it starts.

## Future delivery phases

Implementation proceeds in small, sequential pull requests, each reviewed and
validated before the next begins. These phases are not part of the current
architecture-and-scaffold change:

1. **Language contract and conformance suite**: normative syntax, evaluation,
   JSON value semantics, UTF-8 byte spans, structured errors, resource limits,
   workflow and tool schemas, and strict JSON conformance fixtures.
2. **Execution runtime**: lexer, parser, deterministic evaluator, bounded
   sequential iteration, operation yielding, replay, and conformance runner.
3. **Host SDK**: tool and workflow registries, immutable revisions and aliases,
   workflow composition, deterministic in-memory adapters, and a standalone
   reference host.
4. **Specter workflow Slices**: workflow publication, revision and alias
   queries, and scenario-tested projections derived from the Event Log.
5. **Specter execution and operation Slices**: execution state machine, tool
   request/approval/start/outcome lifecycle, Reaction plugins, recovery, and
   deterministic simulated task tools.
6. **LLM authoring**: provider-neutral interface, fake provider, authoring
   Reaction, validation diagnostics, and bounded repair behavior.
7. **Transport**: typed command/query envelopes, subscriptions, and a browser
   client with runtime boundary validation.
8. **Frontend app**: request-to-workflow authoring, source editing and
   diagnostics, immutable revision publishing, JSON input execution, workflow
   reuse, revision history, approvals, and an execution timeline.
9. **Hardening**: expanded conformance and generated tests, adapter contracts,
   restart/replay and projection-rebuild tests, browser end-to-end tests,
   resource-limit/security checks, and the final live authoring smoke test.

## Test contract

The language behavior is defined by a versioned, language-neutral strict JSON
conformance corpus. It asserts accepted source, result values, ordered external
operations, structured errors and UTF-8 byte spans, and configured limits. It
must not expose TypeScript AST shapes, classes, Promise behavior, or other
implementation details, so a future Rust runtime can run the same fixtures
unchanged.

Testing has four distinct layers:

- shared language conformance tests;
- implementation-specific parser and evaluator tests;
- Specter Slice scenarios and adapter contract tests;
- end-to-end execution, resumption, projection rebuild, and browser tests.

Most tests use deterministic in-memory tools and simulated LLM responses. Live
provider behavior is not part of the normative language contract.

## Security and secret handling

Tool authority is explicit and injectable. Tool definitions carry schemas and
effect metadata so the Specter host can apply permissions, approval, retry, and
uncertain-outcome policies before an adapter runs.

The final OpenRouter smoke test is manual and excluded from `pnpm test`, CI, and
the normal validation baseline. Its future command requires an explicit
`HARLAN_ENABLE_LIVE_AUTHORING_SMOKE=1` opt-in and a server-side credential
provider configured by the user. It must not search arbitrary local
configuration. The test uses a pinned provider/model identifier and a checked-in
non-sensitive fixture; it never sends a user's workflow source, execution input,
workspace contents, or Event Log data.

The smoke permits one bounded repair flow with fixed request, token, timeout,
and documented maximum-cost limits. The OpenRouter credential must never be
printed, copied into this repository, placed in an Event or fixture, sent to the
browser, or included in logs, diffs, commits, or PR text. Errors and provider
responses are sanitized before reporting. All normal validation remains offline
and deterministic.
