# Greenfield Adoption Evaluation Runbook

This directory is the executable companion to the
[greenfield adoption plan](../2026-07-17-greenfield-adoption-plan.md). It fixes
the five-domain matrix, adopter protocol, semantic boundary, verifier contract,
coordinator checks, and analysis format before any of the ten attempts begin.
The [preregistered methodology](methodology.md) and
[friction codebook](friction-codebook.md) are part of the frozen coordinator
contract, not optional analysis guidance.

## Artifact boundary

Do not hand this directory to an adopter wholesale. Build each attempt kit from
an explicit allowlist.

Coordinator state and adopter files must use physically separate roots. The
coordinator root contains full assignments, held-out commands, check cases,
oracles, plans, services, and runner state and is never mounted into the adopter
sandbox. The adopter root contains only allowlisted public artifacts and its
workspace; it must not be a child or parent of the coordinator root. Run
`specter-greenfield rehearse-isolation --contract <file>` from inside the actual
adopter sandbox. The rehearsal must read public canaries and receive only
`EACCES`, `EPERM`, or `ENOENT` for every private canary.

The **adopter-visible kit** contains only:

- `adopter-prompt.md`;
- the assigned domain brief and adopter projection of its matrix entry;
- the assigned domain entries from `semantic-catalog.json`;
- `templates/semantic-map.ts`, `templates/semantic-map.schema.json`, and
  `templates/semantic-map.example.json`;
- the frozen Specter packages, initializer, skill, guidance, reference apps,
  visible acceptance cases, and prepared runtime described by the plan.

The semantic-map contract is self-contained and the adopter produces JSON data,
not an executable coordinator callback. Do not install or expose
`@specter-ts/greenfield-verifier` in the adopter project: that package, its
evidence kinds, standard claims, check placement, and CLI are coordinator-only.

The **private coordinator kit** additionally contains:

- `methodology.md`, `friction-codebook.md`, the materialized candidate table,
  seeded run order, frozen control metadata, environment signatures, and reviewer
  assignments and recommendation-evidence map;
- `coordinator/check-catalog.json`;
- `templates/coordinator-driver.ts` and
  `templates/verification-plan.json`;
- `@specter-ts/greenfield-verifier` and `@specter/evaluation-runner`;
- all concrete check inputs, exact oracles, schedules, fault cases, service
  controls, and held-out commands.

Freeze both kits and their SHA-256 provenance before the first scored command.
Do not add or repair checks after scoring begins. Publish the private kit only
after all ten first attempts are frozen.

## One-time coordinator preparation

1. Complete and publish the near-transfer candidate table under the selection
   rubric in `methodology.md`. Freeze the selected domains, exclusions, reviewer
   decisions, random seed, and tie-break result.
2. Generate the two-block seeded run order: one attempt per domain in each block.
   Freeze the exact model snapshot/build, reasoning setting, system/developer
   prompt digests, tool policy, context limit, execution image, browser revision,
   CPU/memory limits, dependency-cache snapshot, and fresh-context evidence
   required by the methodology.
3. Pack one Specter commit and build the canonical provenance manifest. Include
   every required public/private artifact kind and runtime metadata: exact model
   build and sampler, agent harness, platform, Node/package manager, pinned
   browser revision, services, and run-order seed. The package identity must
   reference its matching public `specterPackage` artifact.
4. Implement every check in `coordinator/check-catalog.json` as a private case
   using `templates/coordinator-driver.ts`. Coordinator services interpret mapped
   brief IDs, drive public HTTP/SSE/browser surfaces, control processes and
   faults, inspect Event/database/outbox state, and retain raw evidence plus
   independent parity comparisons. Cases own all inputs and expectations.
5. Materialize a verification plan per persistence profile from
   `templates/verification-plan.json`. Replace timestamps, timing, iteration,
   generator transcript hashes, and first-use records from the attempt log.
   PostgreSQL plans replace `sqliteRecovery` with both
   `postgresSerialization` and `postgresOutboxClaim`, omit the SQLite harness
   generator records, and use `multiProcess`.
6. Materialize visible cases separately from held-out cases. Visible cases may
   disclose the brief behavior they prove, but never private schedules or
   expected held-out values.
7. Populate the private command paths in
   `coordinator/execution-catalog.template.json`, expand that catalog into two
   attempts per domain, and validate the resulting ten assignments with the
   coordinator package. Cross-check its domain facts against public
   `matrix.json`. Confirm three replication and
   two near-transfer domains, three SQLite and two PostgreSQL profiles, one strict
   port per domain, and attempts 1 and 2 for each domain.
8. Freeze the recommendation-evidence map: recommendation, applicable domains,
   check IDs, friction categories, and historical comparison capability.
9. Preregister environment-failure signatures for the database service, browser,
   dependency cache, credentials, fixed port, and host. Designate the two primary
   reviewers and third adjudicator before they see results.
10. Run a sacrificial, non-scored harness rehearsal. Prove physical access
   isolation from the actual adopter process, kit construction, service reset,
   timer and process-tree termination, freeze immutability, visible-before-held-
   out ordering, semantic-map validation, raw-evidence parity, the 75-minute checkpoint ceiling,
   automatic pause allowlist, 180-minute termination, one-retry environment
   policy, 60-minute remediation clock, and report aggregation. Discard the
   rehearsal data; never alter frozen checks in response to an adopter result.

The JSON schemas in `packages/greenfield-runner/schemas/` are authoritative for
coordinator catalogs, expanded assignments, and provenance. The TypeScript
validator in `packages/greenfield-verifier/src/validation.ts` is authoritative
for verification plans.

The runner's internal `domainKind: "transfer"` value is a storage compatibility
label for the two domains publicly described as `near-transfer`; it does not
authorize broad transfer or cohort-effect claims.

## Build and contract checks

From the repository root:

```sh
pnpm verify:greenfield
```

For a dependency-light verifier protocol check:

```sh
deno test --no-config --sloppy-imports \
  packages/greenfield-verifier/src/runner.test.ts
```

Also parse every JSON artifact, validate the catalog and expanded matrix with
the runner CLI, and validate every materialized plan with the verifier CLI
before freezing provenance.

## Attempt lifecycle

Run assignments only in the frozen two-block randomized order. Each uses a fresh
agent task with no prior evaluation memory or summary. Record the task ID, initial
context size, and every frozen model/prompt/tool/environment control before
starting; a mismatch stops the cohort rather than being pooled.

For each assignment:

1. Create a new empty attempt directory; preparation fails if it already
   exists. Provision its database and fixed port without substituting either.
2. Build frozen provenance from the methodology, codebook, candidate table, run
   order, control metadata, environment signatures, prompt, assigned brief and
   semantic catalog, guidance, packed packages, verifier, runner, check plans,
   cases, oracles, services, browser journeys, and initializer. Store the
   canonical private manifest and full assignment only in the
   coordinator root; expose only a public projection in the adopter root.
3. Generate the adopter assignment with `adopter-assignment`; never copy the
   coordinator matrix because it contains held-out commands.
4. Finish coordinator-only image, cache, browser, empty service, credential,
   tarball, and port provisioning. Do not initialize the app or apply app
   migrations. Run `prepare`, then start the 180-minute active timer immediately
   before the adopter's first command and start the active-limit watchdog with an
   agent/process termination callback. Initializer, install, app setup, migration,
   validation, diagnosis, browser, and idle time are active for both profiles.
5. Record the bootstrap marker before domain work. At `CHECKPOINT_READY` or 75
   active minutes, whichever comes first, automatically pause with reason
   `checkpoint-capture`. Capture an immutable checkpoint diff, log, generator
   transcripts, and visible results; record failed/incomplete at the ceiling.
   Send the same procedural `CONTINUE` and resume the clock. Later app work never
   changes this checkpoint result.
6. On `FINAL_READY`, `TIME_EXPIRED`, or watchdog termination, stop active time
   and run `freeze`. The first-attempt artifact tree is immutable from this
   point onward.
7. Run the visible suite first and then the held-out suite. Each suite receives
   its own disposable copy of the frozen artifacts. The runner re-hashes the
   original freeze after verification. Run every check once. Permit one retry
   only when both designated reviewers confirm a preregistered coordinator-
   environment signature before seeing retry output; preserve both runs and
   apply the nondeterminism and environment-invalid rules in `methodology.md`.
8. Emit the scored attempt report. Only afterward may an unscored remediation
   workspace be created and all findings disclosed to the same adopter. Give it
   a separate 60-active-minute clock and the same automatic pause/environment
   rules; remediation cannot mutate scored evidence.
9. Preserve failed and timed-out attempts. After all ten attempts, run
   `aggregate` and complete `analysis-template.md`.

The full CLI sequence and evidence layout are documented in
`packages/greenfield-runner/README.md`. The verifier CLI and driver contract are
documented in `packages/greenfield-verifier/README.md`.

The runner library does not by itself implement the entire research protocol.
The coordinator wrapper must enforce the seeded block order, fresh-context and
model metadata, 75-minute checkpoint interrupt, pause allowlist, environment
retry/adjudication flow, and 60-minute remediation watchdog. Treat any missing
enforcement as a release blocker, not a manual convention.

## Analysis boundary

Publish attempt- and domain-level descriptive results. The profile and cohort
tables are transparency views only: persistence, domain, and replication versus
near-transfer status are confounded in the current matrix. Do not compare their
rates or times as effects. Apply the fixed recommendation thresholds and dual-
review friction attribution from `methodology.md` and
`friction-codebook.md`.

## Release blockers

The protocol is not ready to score until all of the following are frozen:

- concrete visible and held-out cases for every catalog check and applicable
  persistence profile;
- exact deterministic inputs and expectations for each domain;
- app/service lifecycle implementations for SQLite and PostgreSQL;
- the browser revision and executable browser journeys;
- locally packed Specter packages and complete provenance;
- the published near-transfer candidate rubric table and frozen seeded block order;
- the frozen recommendation-evidence map and applicable-attempt denominators;
- exact model/prompt/tool/image metadata equality and fresh-context evidence;
- coordinator enforcement of checkpoint, pause, retry, environment-invalid,
  adjudication, and remediation rules;
- a successful sacrificial rehearsal with no coordinator mutation of the
  scored freeze and no adopter read access to any private canary.

These are coordinator fixtures, not adopter implementation work. Their absence
must stop the evaluation rather than being filled in after an attempt begins.
