# Frozen Adopter Prompt

You are performing one scored, best-case brownfield adoption attempt. Work only
in the assigned repository and do not delegate. The coordinator will not answer
questions or supply fixes during the scored phase.

You have 90 minutes of active work across both phases. Dependencies, services,
migrations, seed data, and baseline verification have already been prepared.
Stop when the acceptance commands pass or the coordinator interrupts the run.

Maintain `specter-evaluation-log.jsonl` as an append-only chronological record.
Each entry must include an ISO timestamp, phase, action, result, and any failure
or workaround. Do not include credentials or secrets.

## Supplied inputs

- The frozen application and selected migration target.
- A locally packed `@specter-ts/core` at the evaluated commit.
- The Specter skill, runtime guide, reference applications, adapter definitions,
  maintained implementations, and tests.
- The visible `@specter-ts/brownfield-verifier` package and application driver
  stub.
- A fixed snapshot of legacy records that the migration must preserve.
- Baseline and acceptance commands in `specter-assignment.json`.

Do not use the network, install a first-party Specter persistence or scheduler
adapter, add infrastructure, change fixed ports, replace the transport, replace
the test runner, or alter the verifier. You may inspect every supplied file and
run the visible verifier as often as useful.

## Phase 1: application-owned adapters

Implement `EventLogAdapter`, `SliceStoreAdapter`, and `ReactionScheduler` using
only the application's existing database, cache, and durable job system. Make
the supplied verifier driver exercise those real adapters. Continue until the
visible adapter report is green or you decide to proceed with a documented
failure.

## Phase 2: existing-operation migration

Using your adapters:

1. Map the supplied legacy snapshot into explicit bootstrap Events.
2. Prove replay reconstructs equivalent state in the existing domain tables.
3. Move the assigned route's decision and write path behind one domain-named
   Specter Command Slice.
4. Preserve request validation, authentication, success responses, public
   errors, and unrelated legacy behavior.
5. Keep the Event Log authoritative. Project Events into the existing tables;
   do not dual-write around Specter.
6. Add exact accepted and rejected Scenarios, boundary-created IDs and
   timestamps, route tests, restart coverage, and legacy-reader compatibility
   coverage.

Invalid transport input belongs in route tests, not a Scenario. Add a domain
Reaction only when the operation naturally requires asynchronous work; durable
scheduling is always tested by the fixed verifier Reaction.

## Completion record

Before stopping, append a summary entry to the log containing adapter status,
domain status, commands run, known failures, and the paths of the principal
implementation and test files. Do not commit or push; the coordinator freezes
the worktree independently.
