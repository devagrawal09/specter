# Specter Greenfield Verifier

Coordinator-owned verification for frozen Specter greenfield-adoption attempts.
It scores visible and held-out checks through the four cumulative protocol gates
without knowing an adopter's Slice names, Event names, or file layout.

This package is an evaluation harness, not a replacement for an application's
acceptance suite. Each evaluated project supplies a semantic adapter without
verifier check IDs; a private coordinator driver maps frozen checks to that
adapter and coordinator-owned inspection hooks.

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

## Freeze boundary and project-owned adapter

The coordinator freezes visible and held-out check definitions and the
per-domain driver before scoring. That driver must not hardcode an adopter's
Slice/Event names, and the frozen app must never receive a check ID, gate,
visibility, expected value, or verifier claim.

Instead, every app exports a `ProjectSemanticAdapter` with methods keyed by
brief-owned semantic IDs. Its source is frozen with the first-attempt repository.
It maps canonical operations and facts to the app's unconstrained envelopes,
Event names, public transport, persistence records, and operational controls.
The adapter returns observed canonical values and raw ordering/delivery metadata;
it does not decide whether a verifier check passed.

For example, an adopter can map `freight.record-reading` and
`freight.excursion-recorded` without being told to call a Slice or Event by a
particular name:

```ts
import type {
  ProjectSemanticAdapter,
  SemanticProbeResult,
} from '@specter-ts/greenfield-verifier'

export const greenfieldAdapter: ProjectSemanticAdapter = {
  async probe(request): Promise<SemanticProbeResult> {
    switch (`${request.capability}:${request.semanticId}`) {
      case 'command:freight.record-reading':
        return { value: await callReadingEnvelope(request.input, request.signal) }
      case 'eventLog:freight.excursion-recorded':
        return {
          value: await readAndNormalizeExcursionFacts(request.signal),
        }
      default:
        throw new Error(`Unsupported semantic probe: ${request.semanticId}`)
    }
  },
}
```

The private coordinator driver imports that adapter and owns all oracles and
held-out orchestration. It implements the verifier's `GreenfieldDriver` factory:

```ts
import type {
  GreenfieldDriverFactory,
  EvidenceObservation,
} from '@specter-ts/greenfield-verifier'
import { greenfieldAdapter } from './frozen-attempt/greenfield-adapter.js'

export const createGreenfieldDriver: GreenfieldDriverFactory = (plan) => ({
  async setup({ phase, signal }) {
    await resetAndStartCoordinatorServices(phase, signal)
    await greenfieldAdapter.setup?.({ attempt: plan.attempt, phase })
  },

  async runCheck({ check, phase, signal }): Promise<EvidenceObservation> {
    // checkCases and expected values live only in the frozen coordinator kit.
    return checkCases[check.id]({ adapter: greenfieldAdapter, phase, signal })
  },

  async teardown({ phase, reason, signal }) {
    await greenfieldAdapter.teardown?.({ attempt: plan.attempt, phase })
    await stopAndResetCoordinatorServices({ reason, signal })
  },
})
```

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

This executable adapter is preferred to a project-exported manifest: it can map
payloads, normalize domain facts, drive subscriptions, and expose restart/fault
hooks without standardizing implementation names. The adapter contract and
semantic-ID catalog are visible; held-out check IDs, inputs, schedules, faults,
and expected values remain coordinator-only until all first attempts are frozen.

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
