# Specter Brownfield Adoption Evaluation

## Purpose

Evaluate best-case guided adoption of Specter in existing TypeScript apps. Each
adopter must implement Specter's runtime adapters on existing infrastructure,
bootstrap legacy state into Events, and move one guarded operation behind a
Specter Command without changing its public contract or breaking legacy routes.

Run ten attempts: two independent agents for each of five apps. Every agent
implements adapters and then performs the migration with those adapters. Analyze
the phases separately while retaining the end-to-end result.

The primary outcome is a phase-specific friction taxonomy. First-attempt and
remediation success, time, iterations, and implementation size are secondary.
Conclusions apply to this frozen best-case setup, not unaided discoverability.

## Evaluation Set and Controls

Use three coordinator-controlled apps and two existing real-world apps. Freeze
controlled baselines and pin real apps to exact commits. Controlled-app builders
receive no Specter context.

Publish a seeded matrix with each app's domain, stack, database, scheduler,
transport, tests, fixed ports, commands, and migration target. Cover at least
three database and three durable scheduler families. Service topology must
support the tested contracts, including a MongoDB replica set when transactions
require one.

Each baseline must have persistent data and migrations, runtime validation,
stable public conventions, state-dependent operations, an existing durable job
system, public-route tests, and green install, migration, typecheck, test, and
production-build commands.

Before adoption, the coordinator selects one target using a published rubric. It
must be an existing public operation with a meaningful persisted-state guard,
legacy records suitable for bootstrap, and a contract that can be preserved
without migrating all readers. Adopters may not substitute another operation.

Use the same model, reasoning setting, Specter commit, prompt, and limits for all
attempts. Give each fresh agent:

- An isolated baseline and locally packed `@specter-ts/core`.
- The Specter skill, brownfield guide, runtime docs, reference apps, annotated
  adapter definitions, and maintained implementations and tests.
- The complete runnable verification harness.
- A coordinator-produced snapshot of the legacy records to preserve.

Freeze this kit before scoring. Agents may inspect supplied source and use local
tools but receive no outside materials, clarification, coaching, or fixes.
Prepare dependencies, services, ports, and migrations before the clock starts.
Allow 90 minutes of active work across both phases; record phase time and total
wall time separately.

## Adoption Protocol

Two agents independently perform this sequence for each app.

### 1. Implement Existing-Infrastructure Adapters

Implement `EventLogAdapter`, `SliceStoreAdapter`, and `ReactionScheduler` using
only the app's database, cache, and durable job system. Maintained sources may be
studied, but first-party Specter adapters, additional infrastructure, and
replacement transports or test runners are prohibited.

The visible harness is executable documentation. Its fixed Slice and Reaction
probe exercises construction, commits, projection catch-up, durable work, retry,
and restart. The domain operation needs a Reaction only when one naturally
belongs in its workflow.

### 2. Migrate the Existing Operation

Using their own adapters, the agent must:

1. Map the supplied legacy snapshot into bootstrap Events and prove replay
   reconstructs equivalent state.
2. Replace the selected route's decision and write path with one domain-named
   Command Slice.
3. Preserve its request, response, validation, and public errors while keeping
   unrelated legacy routes operational.

After bootstrap, the Event Log is authoritative. Apply handlers update existing
domain tables as Event-derived Slice State so unchanged readers see current
data. State and cursor publication must be atomic or safely idempotent; the
route must not dual-write around Specter.

The Slice requires runtime input validation, exact accepted and rejected
Scenarios, boundary-created domain IDs and timestamps, and a caught-up State
guard. Await app construction in the existing lifecycle. Test invalid input
through the public transport, not as a Scenario.

Freeze the repository and chronological log when acceptance passes or time
expires. The coordinator makes no changes before verification.

## Verification

The frozen harness is the source of truth. Against real app services, it verifies
Event Log ordering, rollback, concurrency, idempotency, JSON and restart;
Slice State staging, atomic state/cursor publication, isolation and replay; and
scheduler serialization, recovery, stable delivery metadata, retry and
dead-letter behavior. The fixed Reaction probe must execute meaningful work, not
an empty pass.

The domain phase must also pass:

- Baseline tests, typecheck, and production build.
- Accepted and prior-Event rejection Scenarios.
- Bootstrap and restart reconstruction of equivalent domain-table State.
- Public-route tests for invalid input without a commit, dispatch through
  `app.command`, durable Event commit, preserved success response, and repeated
  guarded-transition rejection.
- Compatibility tests showing legacy readers observe the projection and
  unrelated routes still work.

Report adapter and domain outcomes separately and identify causal boundaries.
After freezing the first result, give the same agent all verifier findings for
an unscored remediation pass. Record eventual success and extra effort without
changing the first-attempt result.

## Analysis and Publication

Classify friction by adapter contract, bootstrap, Event and Scenario modeling,
lifecycle, transport, legacy projection compatibility, recovery, and guidance.
Call a problem repeated only when it occurs independently in at least two apps;
same-app repetitions remain app- or stack-specific evidence. Report controlled
and real-world results separately.

Publish the matrix, selection rubric, prompts, guidance kit, baselines or pinned
references, first-attempt diffs, sanitized logs, harness and fault cases,
validation results, phase outcomes, timing, iterations, implementation size,
sources consulted, and prioritized recommendations.

Do not change Specter APIs, guidance, examples, or the harness after scoring
begins. Keep product development isolated until all ten first attempts are
frozen and verified.
