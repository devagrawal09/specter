# Greenfield Evaluation Analysis Template

Complete this document only after all ten first-attempt repositories and held-out
results are frozen. Keep remediation evidence in separate columns so it never
changes first-attempt scoring.

## Gate outcomes

| Domain | Attempt | Cohort | Profile | Bootstrap | Vertical path | Domain completeness | Robustness | Full first-attempt success | Remediation |
|---|---:|---|---|---|---|---|---|---|---|
| ED operations | 1 | replication | PostgreSQL | — | — | — | — | — | — |
| ED operations | 2 | replication | PostgreSQL | — | — | — | — | — | — |
| Cold-chain freight | 1 | replication | PostgreSQL | — | — | — | — | — | — |
| Cold-chain freight | 2 | replication | PostgreSQL | — | — | — | — | — | — |
| Property claims | 1 | replication | SQLite | — | — | — | — | — | — |
| Property claims | 2 | replication | SQLite | — | — | — | — | — | — |
| Aircraft turnaround | 1 | transfer | SQLite | — | — | — | — | — | — |
| Aircraft turnaround | 2 | transfer | SQLite | — | — | — | — | — | — |
| Municipal water restoration | 1 | transfer | SQLite | — | — | — | — | — | — |
| Municipal water restoration | 2 | transfer | SQLite | — | — | — | — | — | — |

## Historical recommendation scorecard

Use only `resolved`, `partially resolved`, `regressed`, or `not exercised` in
the status column. The comparison with the 2026-07-16 evaluation is directional;
do not claim causal performance improvement without a matched historical rerun.

| # | Historical recommendation | Status | Replication evidence | Transfer evidence | Remaining risk |
|---:|---|---|---|---|---|
| 1 | Typed subscription transport | — | — | — | — |
| 2 | Production adapters and scheduler presets | — | — | — | — |
| 3 | Separate committed Command outcome from Reaction failure | — | — | — | — |
| 4 | Focused-test Event catalog ergonomics | — | — | — | — |
| 5 | Vertical-Slice and persistent-harness generation | — | — | — | — |
| 6 | Typed projection scaffolding | — | — | — | — |
| 7 | First-party HTTP/browser template | — | — | — | — |
| 8 | Explicit subscription start/context semantics | — | — | — | — |
| 9 | Conformance remediation and propagation tooling | — | — | — | — |
| 10 | Event/Reaction/projection observability | — | — | — | — |
| 11 | Idempotency and concurrency primitives | — | — | — | — |
| 12 | Prominent schema-mode tradeoffs | — | — | — | — |

## Repeated friction

Call a finding repeated only when it appears independently in at least two
different domains. Two attempts in one domain establish reproducibility, not
transfer. Link every count to frozen logs, diffs, verifier results, or command
artifacts.

| Category | Summary | Independent domains | Attempts | First-attempt impact | Remediation impact | Specter attribution |
|---|---|---:|---:|---|---|---|
| initialization | — | — | — | — | — | — |
| generator output | — | — | — | — | — | — |
| Event and Scenario modeling | — | — | — | — | — | — |
| private State and projections | — | — | — | — | — | — |
| app registration | — | — | — | — | — | — |
| persistence | — | — | — | — | — | — |
| Reactions | — | — | — | — | — | — |
| transport and subscriptions | — | — | — | — | — | — |
| UI integration | — | — | — | — | — | — |
| recovery | — | — | — | — | — | — |
| testing | — | — | — | — | — | — |
| toolchain | — | — | — | — | — | — |
| guidance | — | — | — | — | — | — |
| non-Specter | — | — | — | — | — | — |

## Cohort comparison

Report replication and transfer cohorts separately before combining results.
Include first-attempt success, eventual success, median and range for active and
wall time, iterations, files and lines changed, generator decisions, and source
consultations. Report SQLite and PostgreSQL profiles separately as well.

## Publication checklist

- [ ] Matrix, briefs, prompt, guidance, semantic catalog, and package digests.
- [ ] Ten expanded assignments and frozen provenance records.
- [ ] First-attempt repositories, manifests, checkpoint diffs, and raw logs.
- [ ] Visible and held-out check catalogs, drivers, fault cases, and results.
- [ ] Unscored remediation diffs, results, and extra time.
- [ ] Aggregate reports and completed tables above.
- [ ] Unsuccessful and timed-out attempts without omission.
- [ ] Prioritized recommendations with evidence and known limitations.
