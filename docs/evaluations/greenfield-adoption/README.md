# Greenfield Adoption Evaluation Runbook

This directory is the executable companion to the
[greenfield adoption plan](../2026-07-17-greenfield-adoption-plan.md). It fixes
the five-domain matrix, adopter protocol, semantic boundary, verifier contract,
coordinator checks, and analysis format before any of the ten attempts begin.

## Artifact boundary

Do not hand this directory to an adopter wholesale. Build each attempt kit from
an explicit allowlist.

The **adopter-visible kit** contains only:

- `adopter-prompt.md`;
- the assigned domain brief and adopter projection of its matrix entry;
- the assigned domain entries from `semantic-catalog.json`;
- `templates/semantic-adapter.ts`;
- the frozen Specter packages, initializer, skill, guidance, reference apps,
  visible acceptance cases, and prepared runtime described by the plan.

The semantic-adapter template is self-contained. Do not install or expose
`@specter-ts/greenfield-verifier` in the adopter project: that package, its
evidence kinds, standard claims, check placement, and CLI are coordinator-only.

The **private coordinator kit** additionally contains:

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

1. Pack one Specter commit and record every package digest.
2. Implement every check in `coordinator/check-catalog.json` as a private case
   using `templates/coordinator-driver.ts`. Cases may call only brief semantic
   IDs through the frozen app adapter; they own all inputs and expectations.
3. Materialize a verification plan per persistence profile from
   `templates/verification-plan.json`. Replace timestamps, timing, iteration,
   generator transcript hashes, and first-use records from the attempt log.
   PostgreSQL plans replace `sqliteRecovery` with both
   `postgresSerialization` and `postgresOutboxClaim`, omit the SQLite harness
   generator records, and use `multiProcess`.
4. Materialize visible cases separately from held-out cases. Visible cases may
   disclose the brief behavior they prove, but never private schedules or
   expected held-out values.
5. Populate the private command paths in
   `coordinator/execution-catalog.template.json`, expand that catalog into two
   attempts per domain, and validate the resulting ten assignments with the
   coordinator package. Cross-check its domain facts against public
   `matrix.json`. Confirm three replication and
   two transfer domains, three SQLite and two PostgreSQL profiles, one strict
   port per domain, and attempts 1 and 2 for each domain.
6. Run a sacrificial, non-scored harness rehearsal. Prove kit construction,
   service reset, timer termination, freeze immutability, visible-before-held-
   out ordering, semantic adapter loading, and report aggregation. Discard the
   rehearsal data; never alter frozen checks in response to an adopter result.

The JSON schemas in `packages/greenfield-runner/schemas/` are authoritative for
coordinator catalogs, expanded assignments, and provenance. The TypeScript
validator in `packages/greenfield-verifier/src/validation.ts` is authoritative
for verification plans.

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

For each assignment:

1. Create a new empty attempt directory; preparation fails if it already
   exists. Provision its database and fixed port without substituting either.
2. Build frozen provenance from the prompt, assigned brief and semantic
   catalog, guidance, packed packages, and verifier artifact.
3. Generate the adopter assignment with `adopter-assignment`; never copy the
   coordinator matrix because it contains held-out commands.
4. Run `prepare`, start the 180-minute active timer, and start the active-limit
   watchdog with an agent/process termination callback.
5. Record the bootstrap marker before domain work. Record the checkpoint marker
   when the adopter emits `CHECKPOINT_READY`; capture its diff, log, generator
   transcripts, and visible results before sending procedural `CONTINUE`.
6. On `FINAL_READY`, `TIME_EXPIRED`, or watchdog termination, stop active time
   and run `freeze`. The first-attempt artifact tree is immutable from this
   point onward.
7. Run the visible suite first and then the held-out suite. Each suite receives
   its own disposable copy of the frozen artifacts. The runner re-hashes the
   original freeze after verification.
8. Emit the scored attempt report. Only afterward may an unscored remediation
   workspace be created and all findings disclosed to the same adopter.
9. Preserve failed and timed-out attempts. After all ten attempts, run
   `aggregate` and complete `analysis-template.md`.

The full CLI sequence and evidence layout are documented in
`packages/greenfield-runner/README.md`. The verifier CLI and driver contract are
documented in `packages/greenfield-verifier/README.md`.

## Release blockers

The protocol is not ready to score until all of the following are frozen:

- concrete visible and held-out cases for every catalog check and applicable
  persistence profile;
- exact deterministic inputs and expectations for each domain;
- app/service lifecycle implementations for SQLite and PostgreSQL;
- the browser revision and executable browser journeys;
- locally packed Specter packages and complete provenance;
- a successful sacrificial rehearsal with no coordinator mutation of the
  scored freeze.

These are coordinator fixtures, not adopter implementation work. Their absence
must stop the evaluation rather than being filled in after an attempt begins.
