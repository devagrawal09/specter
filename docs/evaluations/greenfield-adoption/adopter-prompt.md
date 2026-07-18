# Frozen Greenfield Adopter Prompt

You are one independent adopter building a new Specter 0.3 application. Your
result is scored as a product-adoption attempt, so follow this protocol exactly.
The coordinator records shell activity and active time. Do not optimize for or
speculate about unpublished checks; build the product described by your brief.

## Supplied materials

You receive a frozen, read-only guidance kit:

- one implementation-neutral product brief and its row in `matrix.json`;
- the visible brief-owned entries from `semantic-catalog.json` and the
  self-contained typed semantic-adapter template;
- locally packed Specter 0.3 packages and a `create-specter` executable on PATH;
- the canonical Specter skill;
- the generated project's README and agent guidance;
- `docs/guides/runtime-boundaries.md`;
- the README for core, the assigned persistence adapter, Reaction outbox,
  observability, and `create-specter`;
- the Todo, booking, and Threadplane reference applications;
- a runnable visible acceptance suite and coordinator-prepared service/browser
  environment.

You may inspect supplied local source and use local development tools. Do not
use the internet, outside documentation, historical evaluation source or
reports, another repository, or materials not in the kit. Do not delegate to a
subagent or another person. You receive no clarification, coaching, suggested
fixes, or maintainer intervention during the scored attempt. If the brief is
ambiguous, record the ambiguity and make the smallest defensible assumption.

Do not modify or patch Specter packages. Do not replace the generated JSON
HTTP/SSE transport, build a custom runtime adapter, switch persistence profile,
or substitute a scheduler. App-owned domain code, projection tables, migrations,
UI, and tests are expected.

## Required semantic adapter

Create `specter-evaluation/semantic-adapter.ts` from the supplied template and
implement every semantic ID assigned to your domain. This is an evaluation seam,
not a prescribed domain model: it maps stable brief-owned operations, views,
normalized facts, and operational controls to your freely chosen Command, Query,
Event, projection, and process names.

The adapter receives only `semanticId`, capability, input, phase, and an abort
signal. It must return canonical public values or normalized facts plus raw log,
cursor, delivery, or lifecycle metadata where the catalog requires them. It must
not contain verifier check IDs, expected values, pass/fail claims, fixture-order
recognition, or held-out logic. The visible suite checks catalog completeness.
The coordinator freezes this adapter with the app and privately supplies all
held-out inputs, schedules, faults, oracles, and check orchestration.

## Clock and deliverables

You have **180 active minutes** for bootstrap, checkpoint, and complete-app work
combined. Coordinator provisioning, checkpoint capture, verifier execution, and
an unavailable prepared service do not consume active time. Ordinary installs,
builds, tests, diagnosis, browser work, and your own idle time do.

Maintain `ADOPTION_LOG.md` from the first command onward in strict chronological
order. For each material action record:

- active elapsed time;
- exact command or file area changed;
- outcome and relevant failure text;
- diagnosis and next decision;
- supplied guidance consulted;
- every generator dry-run and generation command;
- generated files kept, edited, discarded, or not reused, with the reason;
- semantic adapter mappings added or changed;
- validation results and when a checkpoint/final freeze is requested.

Do not rewrite the log into a cleaner narrative. Correct mistakes with a later
entry. The coordinator's transcript is authoritative if the log differs.

## Phase 1: bootstrap and one vertical path

1. In the empty assigned parent directory, run the coordinator-supplied
   initializer command against the locally packed release. Use the generated
   stack and install the prepared dependencies.
2. Set the exact strict port and persistence profile from `matrix.json`. If the
   port is occupied, report the conflict; do not select another port.
3. Apply migrations. Before any domain changes, prove the unchanged starter by
   running:

   ```sh
   npm run typecheck
   npm run test
   npm run build
   npm run test:e2e:preflight
   npm run test:e2e
   ```

   Record any starter failure. Do not repair a Specter package to bypass it.
4. Remove the sample domain as you replace it. Implement the checkpoint
   operation named by the brief as a minimal end-to-end vertical path: accepted
   and prior-history rejection Scenarios, runtime input validation, domain fact
   definitions, private decision State, registration, one Query projection,
   public envelope transport, and visible UI behavior. Initiating IDs and
   timestamps come from the request boundary.
5. Immediately before authoring the **first Command and first Query Slice** used
   by the checkpoint, choose the names and feature boundary yourself, then run
   the generator once in dry-run mode and once without `--dry-run`. Apply the
   same rule immediately before the first Reaction Slice in phase 2:

   ```sh
   create-specter generate slice <chosenName> --kind <command|query|reaction> --feature <chosen-feature> --dry-run
   create-specter generate slice <chosenName> --kind <command|query|reaction> --feature <chosen-feature>
   ```

   Do not use `--force` to overwrite authored files. Review generated support
   files rather than treating their layout as additional framework rules. You
   may hand-author later Slices. Log why generated output was retained, changed,
   or not reused.
6. For a SQLite assignment, before implementing recovery behavior run both:

   ```sh
   create-specter generate persistent-harness --dry-run
   create-specter generate persistent-harness
   ```

   Adapt the generated seams to your app. For PostgreSQL, do not generate the
   SQLite harness; use the coordinator-supplied service-backed recovery harness.
7. When the checkpoint's focused Scenario, public-route, persistence, and
   visible browser acceptance tests pass, append `CHECKPOINT_READY` with active
   elapsed time and stop editing. The coordinator captures the diff, log, test
   output, and generator transcript. Resume only after the coordinator sends
   the procedural `CONTINUE` signal; that signal contains no advice.

## Phase 2: complete the workflow application

Implement every required operation, guard, Query field/filter, asynchronous
effect, live update, restart/replay behavior, and both browser journeys in the
brief. Keep the durable Event Log authoritative from the first accepted domain
operation. Command decisions use their own caught-up private State rather than
Query projections. Query and decision projections must be reconstructible from
history.

Complete and test the domain's semantic adapter as behavior is added. Its
restart, replay, fault-injection, process-control, outbox, and browser mappings
may call app-owned test/operations seams, but must exercise the same maintained
adapters, scheduler, transport, and database used by the scored application.

Every Slice has exact executable Scenarios and uses runtime schemas at untrusted
input, public Query-output, and Reaction Plugin boundaries. Commands emit only
facts authorized by accepted outcomes. Keep sibling Slices independent, keep
server/database imports out of the remote UI, and use JSON-compatible transport
values.

The required Reaction must perform its meaningful domain operation through a
typed normal Command envelope. Use the retry-stable delivery identity as the
downstream idempotency key. Preserve the difference between committed Command
completion and later Reaction completion. Use the generated abortable,
reconnecting SSE query transport for live browser behavior.

Run narrow checks while working. Before requesting the final freeze, run the
full visible baseline:

```sh
npm run check
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e:preflight
npm run test:e2e
```

## Visible and held-out verification

The product brief and supplied visible suite are available throughout the
attempt. A separate frozen held-out suite is not available until every scored
attempt is finished. It covers only published or brief-defined behavior and is
independent of your internal names and decomposition. It probes concurrency,
idempotency, restart, replay, cursor/apply fault recovery, transport abuse,
subscription reconnect/cleanup, and durable Reaction retry/dead-letter behavior.

Do not add code that recognizes fixture ordering, test process identity, or
specific verifier mechanics. General product correctness is the target.

## Final freeze and remediation

Stop immediately when all visible acceptance passes or when 180 active minutes
expires. Append either `FINAL_READY` or `TIME_EXPIRED`, the active elapsed time,
and a candid list of known failures. Make no changes while the coordinator
reruns visible checks and executes held-out verification. First-attempt scoring
is permanently based on this frozen repository and log.

After scoring, the coordinator may provide all verifier findings and explicitly
start an **unscored remediation pass**. Only then may you edit again. Record
additional time and changes separately; remediation can establish eventual
success but cannot alter the first-attempt result.
