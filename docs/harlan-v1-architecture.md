# Harlan v1 Architecture

## Goal

Harlan v1 is a portable language for dynamically composing task-specific tools
into saved, reusable workflows. The reference product lives in `apps/harlan` in
the Specter monorepo, while the language and execution runtime remain usable
without Specter, a filesystem, a VM, a container, or a sandbox.

This is a focused v1. It does not migrate legacy Harlan sessions, scripts, CLI
behavior, or UI behavior.

## Product decisions

1. The reference implementation is a new Specter monorepo app at
   `apps/harlan`.
2. SQLite through the Specter Event Log is the app's sole durable truth.
   Workflow source, immutable revisions, execution inputs, tool outcomes, and
   final results are events; catalogs, timelines, and other indexes are
   rebuildable projections.
3. An authoring LLM turns requests into Harlan source and can revise invalid
   scripts. Tests use a fake provider. Only the final smoke test uses a small,
   inexpensive Gemini Flash model through OpenRouter.
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

The host SDK owns tool and workflow registries, immutable workflow revisions,
alias resolution, workflow-as-tool composition, and an in-memory reference
host. The reference host proves that Harlan can execute and reuse workflows
without Specter or environmental capabilities.

The Specter host owns durability, authorization, approvals, idempotency,
retries, uncertain outcomes, causal history, and resumption. Every external
tool call crosses Specter command and Reaction boundaries:

```text
request workflow execution
  -> evaluate until an unresolved operation
  -> request tool operation command
  -> tool Reaction invokes the task adapter
  -> record operation outcome command
  -> reevaluate with recorded outcomes
  -> complete or yield the next operation
```

Pure language evaluation does not emit commands. On resumption the runtime
replays deterministically from the beginning, consuming recorded operation
results in order, rather than serializing an interpreter continuation.

Saved workflows are immutable, content-addressed artifacts and are exposed to
Harlan through the same call interface as native tools. Mutable aliases may
point to immutable revisions, but an execution resolves and records the exact
revision before it starts.

## Delivery phases

Implementation proceeds in small, sequential phases, each reviewed and
validated before the next begins:

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

The OpenRouter credential used for the final smoke test is read at execution
time from the user's existing local configuration. It must never be printed,
copied into this repository, placed in an event or fixture, sent to the browser,
or included in logs, diffs, commits, or PR text. The live test is cost-bounded;
all normal validation remains offline and deterministic.
