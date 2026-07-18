# Specter Greenfield Verifier

Coordinator-owned verification for frozen Specter greenfield-adoption attempts.
It scores visible and held-out checks through the four cumulative protocol gates
without knowing an adopter's Slice names, Event names, or file layout.

This package is an evaluation harness, not a replacement for an application's
acceptance suite. Each evaluated project supplies a data-only semantic map
without verifier check IDs; a private coordinator driver maps frozen checks to
coordinator-owned transport, browser, process, fault, and inspection services.

## What it records

- Bootstrap, vertical-path, domain-completeness, and robustness gates.
- Visible and held-out checks, with mandatory checks kept distinct from
  supplementary probes.
- The strict first-attempt outcome. Success requires every cumulative gate and
  no more than 180 active minutes.
- A separately executed, unscored remediation outcome. Remediation never
  changes the frozen first-attempt result.
- Active and wall time, iterations, guidance consulted, generator dry-runs and
  generations, invocation chronology, transcript SHA-256 hashes, first-Slice-use
  timing, generated-output disposition, implementation size, persistence
  profile, topology, and provenance.
- Deterministically key-sorted JSON suitable for publishing and diffing.

Plan validation is intentionally strict. It rejects missing protocol evidence,
duplicate checks, ports outside `10000..65535`, noncanonical evidence placement,
mismatched persistence topology, incomplete phase records, generator transcripts
without SHA-256 provenance, generator pairs that are reversed or use incomparable
clocks, missing first-use command/query/Reaction Slice pairs, missing or late
SQLite recovery-harness generation relative to its recorded first use, fewer
than two browser journeys, and Postgres plans without multi-process
serialization and outbox-claim checks.

## Freeze boundary and data-only semantic map

The coordinator freezes visible and held-out check definitions, observation
services, and the per-domain driver before scoring. The frozen app must never
receive a check ID, gate, visibility, expected value, or verifier claim.

Instead, every app includes a schema-validated `semantic-map.json` keyed by
brief-owned semantic IDs. It is data, not an imported executable module. It maps
Commands, Queries, subscriptions, Event types, normalization JSON Pointers,
browser routes, and stable selectors to the app's unconstrained public names.
It cannot execute checks, inspect persistence, restart processes, inject faults,
or report observations.

For example, an adopter can map a brief operation without being told to call a
Slice or Event by a particular name:

```json
{
  "schemaVersion": 1,
  "domain": "cold-chain-freight",
  "mappings": {
    "cold-chain-freight.command.record-temperature-sample": {
      "capability": "command",
      "envelopeType": "acceptSensorReading",
      "request": { "kind": "identity" },
      "result": { "kind": "identity" }
    }
  }
}
```

The private coordinator driver parses that JSON and owns all oracles and
held-out orchestration. Coordinator-owned services drive HTTP/SSE/browser
surfaces, control processes and faults, and inspect Event/database/outbox state:

Every requested command, query, subscription, Event-log, or browser semantic ID
must have a mapping with the requested capability. A missing entry is a contract
failure; it never falls through to coordinator operational observation. Only
restart, replay, fault, process, outbox, and Reaction-delivery capabilities may
be intentionally unmapped and handled by coordinator-owned services.

The service result contains raw channel captures, coordinator normalization,
artifact paths, and parity comparisons between independently observed surfaces.
For example, a Command receipt can be compared with durable Event facts, and an
SSE update can be compared with a direct Query and browser value. A check without
raw artifacts and at least one parity comparison is a harness error.

### Per-check isolation

`setup` and `teardown` are required and run around every check, including every
visible and held-out check. `setup` must begin from a reset database, processes,
fault controls, subscriptions, and scheduler state appropriate to that check.
`teardown` must be idempotent, terminate child work, close subscriptions and
connections, and restore that reset boundary.

The verifier aborts `runCheck` when its check timeout expires, waits for it to
settle, then runs teardown through a bounded cleanup path. `runCheck`, `setup`,
and `teardown` must observe their `AbortSignal` and settle promptly after abort.
If setup, check work, or teardown remains active after its abort grace, the
verifier marks isolation compromised, does not start another check, and blocks
remediation in that process. Library callers can reduce or extend
`setupTimeoutMs`, `cleanupTimeoutMs`, and `abortGraceMs`; coordinator drivers
must not rely on those limits as a substitute for cleanup.

The semantic-map contract and semantic-ID catalog are visible; held-out check
IDs, inputs, schedules, faults, expected values, observation services, and raw
evidence interpretation remain coordinator-only until all attempts are frozen.
Process control, restart, replay, fault injection, Reaction delivery, database,
and outbox capabilities never have adopter-executable mappings.

Each evidence kind has standard semantic claims exported as `standardClaims`.
For example, `reactionDeliveryRecovery` requires a persisted failed attempt,
retry-stable delivery ID and schedule time, changing attempt IDs, no duplicated
effect, restart recovery, and a visible success or dead letter. A false or
missing required claim fails the check. `comparisons` are deep-compared by the
verifier, so drivers can report exact accepted Events, rejection errors, public
Query values, and browser outcomes without teaching the verifier internal names.
`canonicalEvidencePlacement` exports the mandatory gate/visibility assignment
for every evidence kind; validation applies it to supplemental checks too.

The contract models:

- whole-app Scenario and registered Event coverage;
- exact accepted/rejected behavior and invalid-input no-commit behavior;
- idempotent duplicates and concurrent decisions;
- restart, catch-up, replay repair, cursor publication, and global ordering;
- committed Command versus Reaction completion and durable delivery recovery;
- stable HTTP JSON/error boundaries;
- SSE initial/update/reconnect/abort behavior and browser journeys;
- real-file SQLite recovery; and
- Postgres multi-process serialization and outbox claims.

Use `additionalClaims` on a check for brief-specific facts such as an SSE update
coming from another request rather than a local refresh.

## CLI

Build the package, then run:

```sh
specter-greenfield-verify \
  --config ./verification-plan.json \
  --driver ./coordinator-driver.mjs \
  --output ./first-attempt-result.json
```

After the first-attempt repository and result are frozen, add remediation
metadata to the same plan and run the agent-remediated repository separately:

```sh
specter-greenfield-verify \
  --config ./verification-plan.json \
  --driver ./coordinator-driver.mjs \
  --output ./result-with-remediation.json \
  --remediation
```

The CLI exits `0` only for full first-attempt success, `1` for a valid verified
attempt that did not fully pass, and `2` for invalid configuration or harness
failure. Library callers can use `validateVerificationPlan`,
`verifyGreenfieldAttempt`, and `stringifyVerificationResult` directly.

When launched by `@specter/evaluation-runner`, the CLI also receives
`SPECTER_EVALUATION_ATTEMPT_ID`, `SPECTER_EVALUATION_CONFIG_SHA256`,
`SPECTER_EVALUATION_SNAPSHOT_KIND`, and
`SPECTER_EVALUATION_SNAPSHOT_SHA256`. All four or none must be present. The CLI
checks the attempt ID and emits them as `coordinatorBinding`, together with the
SHA-256 of the exact plan bytes. The runner rejects absent, partial, stale, or
cross-phase bindings before using any gates.
