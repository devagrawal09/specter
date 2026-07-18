# Specter Greenfield Adoption Evaluation

Related evaluations: [multi-app Specter evaluation](2026-07-16-multi-app-specter-evaluation.md)
and [brownfield adoption plan](2026-07-17-brownfield-adoption-plan.md). The
[coordinator runbook](greenfield-adoption/README.md) defines the frozen artifact
boundary and execution procedure for this plan. The
[preregistered methodology](greenfield-adoption/methodology.md) fixes timing,
randomization, retry, adjudication, remediation, inference, and recommendation
status rules; the [friction codebook](greenfield-adoption/friction-codebook.md)
fixes qualitative classification before scoring.

## Purpose

Evaluate best-case guided adoption of Specter 0.3 in new TypeScript
applications. Fresh agents must turn implementation-neutral product briefs into
complete, persistent workflow apps using the shipped initializer, generators,
maintained adapters, durable Reaction scheduling, and project-owned transport.

Run ten attempts: two independent agents for each of five apps. Three apps
replicate the domains and required outcomes from the 2026-07-16 multi-app
evaluation; two new domains test near-transfer to unfamiliar business vocabulary.
Every attempt includes project bootstrap, one checkpointed vertical path, and a
complete application. Analyze those phases separately while retaining the
end-to-end result.

The two added apps are near-transfer tests: they change business vocabulary and
workflow details while retaining the guarded, persistent, Reaction-driven
application shape. They do not support claims about arbitrary greenfield
software. Persistence profile, cohort, and domain are not independently
randomized, so report domain-level descriptive results only. Do not infer
SQLite-versus-PostgreSQL or replication-versus-near-transfer effects without a
redesigned and preregistered crossed or randomized matrix.

The primary outcome is a phase-specific friction taxonomy and an assessment of
whether the earlier evaluation's resolved recommendations stay resolved in
practice. First-attempt and remediation success, time, iterations, generator
use, and implementation size are secondary. This evaluates the frozen guided
Specter path, not unaided discovery, visual design quality, or general coding
agent capability.

## Evaluation Set and Controls

Reuse emergency-department operations, cold-chain freight control, and
property-insurance claims as replication domains. Derive new briefs from their
product behavior and acceptance outcomes, not their prior implementations,
Event vocabularies, Slice decompositions, or reports. Select two near-transfer
domains with similarly rich guarded workflows before attempts begin using the
eligibility, reviewer, tie-break, and publication rubric in the preregistered
methodology. Publish every considered candidate and score. Do not use
Todo, meeting-room booking, or Threadplane-style collaboration because current
Specter examples already expose those domains.

Publish a seeded matrix with each app's domain, required workflows, persistence
profile, process topology, assigned fixed five-digit port, browser journeys,
service setup, and verification commands. Use the generated stack for every app
so framework choice does not obscure Specter findings. Assign three apps the
default single-process SQLite profile and two apps the maintained PostgreSQL
multi-process profile. All apps use the durable outbox scheduler for scored
Reaction behavior. This allocation exercises both supported paths; because it is
fixed by domain, it is not a profile comparison.

Each brief must require, without prescribing Slice or Event names:

- Several state-dependent operations with at least two meaningful rejection
  guards and one optimistic-concurrency or duplicate-submission case.
- Operational queries with filtering and a live view that can change because
  of another request or a Reaction, not only the current browser action.
- At least one natural asynchronous effect whose Reaction dispatches a normal
  guarded Command and can be retried safely.
- Persistent restart, projection catch-up, replay, and recovery behavior.
- Two end-to-end browser journeys that together cover the app's critical happy
  path and guarded failure path.

Briefs define domain rules, initiating IDs and timestamps, observable responses,
and acceptance behavior, but leave Event modeling, Slice boundaries, private
State, and projection design to the adopter. Match the three replication briefs
as closely as current APIs allow to the historical domain scope. Historical
source, logs, reports, and recommendation text remain unavailable to agents.

Use two seeded randomized blocks, each containing one attempt per domain, as
specified by the preregistered methodology. Use a genuinely fresh agent task for
every attempt and the same exact model snapshot/build, reasoning setting, prompt
digests, tool policy, context limit, Specter commit, execution image, browser
revision, prepared dependency cache, and limits. Record those controls for every
run and stop rather than pool attempts if a frozen control changes. Delegation is
prohibited so one attempt represents one fresh agent.
Give each agent:

- An empty isolated parent directory, locally packed Specter 0.3 packages, and
  the `create-specter` executable; the agent must run the initializer.
- The Specter skill, generated project guidance, runtime-boundary guide, package
  READMEs, and reference apps.
- The implementation-neutral product brief and runnable visible acceptance
  suite, plus the brief-owned semantic-ID catalog and self-contained data-only
  semantic-map contract. The coordinator verifier package is not supplied.
- Prepared dependencies, database services, browser revision, and assigned port.

The coordinator separately freezes held-out robustness tests for concurrency,
restart, fault injection, transport abuse, subscription cleanup, and durable
Reaction recovery. These tests exercise published or brief-defined behavior and
must not depend on an agent's internal names, file layout, or Slice decomposition.
Each app declaratively maps visible semantic IDs to its unconstrained public
envelopes, normalized durable facts, and browser locators. Private coordinator
services independently drive HTTP/SSE/browser/process behavior, inject faults,
inspect databases/outboxes, capture raw evidence, and cross-check mapped values.
They own all check IDs, inputs, schedules, faults, claims, and expected values.

Freeze both kits before scoring. The coordinator provisions the execution image,
package cache, browser, empty database service, credentials, fixed port, and local
tarballs before active time. Active time begins immediately before the adopter's
first command and includes initializer execution, dependency installation, app
configuration, migration authoring/generation/application, starter validation,
implementation, tests, builds, browser work, diagnosis, and agent idle time for
both persistence profiles. Agents may inspect supplied source and use local tools
but receive no outside materials, clarification, coaching, or fixes. Allow
180 minutes of active work across both phases; record setup time, phase time,
and total wall time separately. Agents may not modify Specter packages, replace
the generated transport, implement custom runtime adapters, or substitute a
different persistence profile.

Only coordinator-controlled pauses from the preregistered allowlist stop active
time. Every pause records a reason, monotonic timestamps, and evidence. App work,
installs, migrations, commands, tests, diagnosis, and adopter inactivity never
qualify for a pause.

## Adoption Protocol

Two agents independently perform this sequence for each app.

### 1. Bootstrap and Complete One Vertical Path

Run the initializer against the locally packed release, install dependencies,
set the assigned strict port, apply migrations, and, before making domain
changes, prove the starter passes typecheck, tests, production build, browser
preflight, and its browser workflow. Starter failures count as bootstrap
findings; the coordinator does not repair them during an attempt.

The brief identifies one representative guarded operation as the checkpoint
target. The agent must replace the sample domain with a minimal end-to-end path
for that operation: exact accepted and prior-Event rejection Scenarios, runtime
input validation, Event Definitions, private decision State, app registration,
one query projection, a public envelope call, visible UI behavior, and the
checkpoint's semantic-map entries. Domain IDs and timestamps originate at
the initiating boundary.

For the first Slice of each kind used in the app, run `create-specter generate
slice` in dry-run mode before generation. In SQLite attempts, run the
persistent-harness generator in dry-run mode and then generate it before
implementing recovery behavior. PostgreSQL attempts use the coordinator's
equivalent service-backed recovery harness because the shipped generator is
SQLite-specific. The agent may hand-author later Slices, but must record why
generated files were kept, changed, or not reused. Freeze a checkpoint diff and
chronological log as soon as the selected vertical path passes its focused
Scenario, public-route, and browser acceptance tests. Phase 1 has a fixed ceiling
of 75 active minutes. At `CHECKPOINT_READY` or that ceiling, whichever comes
first, the coordinator pauses, freezes the checkpoint evidence, and sends the
same advice-free `CONTINUE`. A checkpoint that has not passed at 75 minutes is
recorded failed or incomplete; phase 2 begins with the remaining total budget.
Unused checkpoint time carries forward, but phase 1 cannot borrow beyond 75
minutes.

### 2. Complete the Workflow Application

Expand the checkpoint into the full product brief. Remove the Todo sample
domain and implement all required Commands, Queries, Reactions, projections,
UI states, and browser journeys. The Event Log must be authoritative from the
first accepted Command. Command decisions use caught-up private State rather
than Query projections, and unchanged read models are reconstructed from Events.

Every Slice has exact executable Scenarios and runtime schemas at untrusted
input, public Query-output, and Reaction Plugin boundaries. Command handlers emit
only authorized Event types. Domain IDs, timestamps, and randomness enter at an
initiating boundary. Slices do not import siblings, and remote UI code does not
import server or database modules.

Use the assigned maintained persistence adapter and durable scheduler. The
required Reaction must perform meaningful domain work through a typed Command
envelope, use retry-stable delivery metadata for idempotency, and preserve the
distinction between committed Command Events and later Reaction completion.
Live UI behavior uses the generated abortable, reconnecting SSE query transport.

Keep a chronological build log containing commands, failures, diagnoses,
guidance consulted, generator invocations, manual changes to generated output,
and validation results. Freeze the repository and log when acceptance passes or
time expires. The coordinator makes no changes before verification.

## Success Gates

Score first-attempt progress through four cumulative gates:

1. **Bootstrap:** before domain changes, the initialized starter passes its
   required checks on the assigned port and persistence environment.
2. **Vertical path:** in the immutable checkpoint captured no later than 75 active
   minutes, the checkpoint operation passes focused Scenarios, public transport
   acceptance, persistence, and its visible browser behavior. Later complete-app
   work cannot retroactively pass this gate.
3. **Domain completeness:** the finished app implements the entire
   historical-scope brief and passes all visible checks and both browser
   journeys.
4. **Robustness:** the frozen app passes every held-out concurrency, restart,
   replay, fault, Reaction, transport, and cleanup check.

Report every gate independently, but count an attempt as a full first-attempt
success only when all four gates pass within 180 active minutes. A later gate
cannot compensate for an earlier failure, and partial credit must not be
converted into a weighted aggregate score. The unscored remediation result is a
separate eventual-success measure.

## Verification

The visible acceptance suite and held-out robustness suite together are the
source of truth. After the repository is frozen, the coordinator first reruns
all visible checks and then runs the held-out suite without modifying the app.
Run the app's check, lint, boundary lint, typecheck, tests, production build,
browser preflight, and complete Playwright workflow. Verify that every registered
Event Definition and Slice is covered by whole-app Scenario execution and that
focused tests use a focused Event catalog. The coordinator driver interprets the
frozen data-only semantic map but executes probes through coordinator-owned
services. Verifier check IDs and oracles never cross that boundary, and mapped
values must agree with independently captured raw transport, browser, Event-log,
database, or outbox evidence.

Run checks once in their preregistered order from a clean per-check environment.
Do not retry product failures, assertion mismatches, crashes, timeouts,
nondeterminism, or unexplained failures. Permit exactly one clean retry only
after two reviewers, before seeing its outcome, confirm a preregistered
coordinator-environment failure signature. Preserve both results and apply the
environment-invalid, flake, retry, and evaluation-wide harness-defect rules in
the preregistered methodology.

For every app, the verifier must also prove:

- Accepted Commands commit exact durable Events, rejected and schema-invalid
  inputs commit none, duplicate idempotency keys return the original commit, and
  conflicting decisions serialize or reject stale versions.
- Restart and catch-up reconstruct equivalent decision and Query State; replay
  repairs projections; failed apply/cursor publication is atomic or safely
  idempotent; Events retain unique ascending global order.
- Command completion is observable before Reaction completion; injected effect
  failure persists an attempt; retry retains delivery identity, avoids duplicate
  effects, and can reach success or a visible dead letter after restart.
- HTTP accepts only registered JSON envelopes, preserves stable structured
  errors, and does not leak unexpected failures. SSE emits initial and updated
  values, survives reconnect, and cleans up on abort.
- Both browser journeys satisfy the brief through public transport, including
  one live update not caused by a local refresh.

SQLite attempts run recovery against a real on-disk database. PostgreSQL
attempts run against the service database and add multi-process command
serialization and outbox-claim tests. A fixed Reaction probe may supplement the
domain flow but cannot replace meaningful domain Reaction coverage.

Report bootstrap, checkpoint, and complete-app outcomes separately and identify
causal boundaries. After freezing the first result, give the same agent all
visible and held-out verifier findings for a fixed 60-active-minute unscored
remediation pass. Apply the same pause and environment rules, then run one clean
visible-then-held-out verification. Record eventual success and extra effort
without changing the first-attempt result.

## Analysis and Publication

Classify friction by initialization, generator output, Event and Scenario
modeling, private State and projections, app registration, persistence,
Reactions, transport and subscriptions, UI integration, recovery, testing,
toolchain, and guidance. Attribute non-Specter failures separately. Call a
problem repeated only when it occurs independently in at least two domains;
same-domain repetitions demonstrate reproducibility but not transfer.

Two reviewers independently classify every episode's phase, category, severity,
attribution, confidence, and causal chain using the frozen friction codebook.
Publish pre-adjudication agreement and preserve both labels; a predesignated
third reviewer resolves disagreements without changing checks or attempts.
Retain `mixed` and `uncertain` attribution when evidence does not support a
single cause.

For the three replication domains, compare capability coverage, failure types,
iterations, time, and app-owned infrastructure with the historical evaluation.
Treat this as a directional before-and-after comparison because the prompts,
harness, agent repetitions, and Specter guidance differ; do not claim a causal
performance improvement without rerunning both commits under the same protocol.
Track each historical recommendation explicitly as resolved, partially
resolved, regressed, or not exercised using the preregistered numerator,
denominator, independent-domain, and repeated-friction thresholds. Report the
two near-transfer domains separately, but do not treat their aggregate or the
persistence split as an estimated cohort/profile effect.

Publish the matrix, briefs, prompts, frozen guidance kit, package provenance,
first-attempt and remediation diffs, sanitized logs, checkpoint artifacts,
generator transcripts, visible and held-out harnesses, fault cases, validation
results, gate outcomes, timing, iterations, implementation size,
source-consultation record, and prioritized recommendations. Preserve
unsuccessful and timed-out attempts. Publish held-out tests only after all ten
first attempts are frozen.

Do not change Specter APIs, packages, guidance, examples, briefs, or the verifier
after scoring begins. Keep product development isolated until all ten
first-attempt repositories are frozen and independently verified.
