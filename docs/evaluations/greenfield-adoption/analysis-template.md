# Greenfield Evaluation Analysis Template

Complete this document only after all ten first-attempt repositories and held-out
results are frozen. Keep remediation evidence in separate columns so it never
changes first-attempt scoring.

This analysis follows the fixed rules in [methodology.md](methodology.md) and
[friction-codebook.md](friction-codebook.md). All profile and design-role views
are descriptive. The current matrix cannot estimate persistence-profile or
replication-versus-near-transfer effects.

## Preregistration and control audit

| Item | Frozen value or artifact | Deviations | Included in pooled descriptive total? |
|---|---|---|---|
| Near-transfer candidate table and reviewers | — | — | — |
| Randomization seed and two-block order | — | — | — |
| Model identifier and snapshot/build | — | — | — |
| Reasoning setting and context limit | — | — | — |
| System/developer/tool-policy digests | — | — | — |
| Specter/package/guidance/prompt digests | — | — | — |
| OS image, browser revision, CPU/memory | — | — | — |
| Environment-failure signatures | — | — | — |
| Reviewers and third adjudicator | — | — | — |
| Recommendation-evidence map | — | — | — |

| Block | Position | Domain | Attempt | Fresh task ID | Initial context | Control match | Outcome or invalid-run replacement |
|---:|---:|---|---:|---|---:|---|---|
| — | — | — | — | — | — | — | — |

## Gate outcomes

| Domain | Attempt | Design role | Assigned profile | Bootstrap | Vertical path by 75m | Domain completeness | Robustness | Full first-attempt success | 60m remediation |
|---|---:|---|---|---|---|---|---|---|---|
| ED operations | 1 | replication | PostgreSQL | — | — | — | — | — | — |
| ED operations | 2 | replication | PostgreSQL | — | — | — | — | — | — |
| Cold-chain freight | 1 | replication | PostgreSQL | — | — | — | — | — | — |
| Cold-chain freight | 2 | replication | PostgreSQL | — | — | — | — | — | — |
| Property claims | 1 | replication | SQLite | — | — | — | — | — | — |
| Property claims | 2 | replication | SQLite | — | — | — | — | — | — |
| Aircraft turnaround | 1 | near-transfer | SQLite | — | — | — | — | — | — |
| Aircraft turnaround | 2 | near-transfer | SQLite | — | — | — | — | — | — |
| Municipal water restoration | 1 | near-transfer | SQLite | — | — | — | — | — | — |
| Municipal water restoration | 2 | near-transfer | SQLite | — | — | — | — | — | — |

## Historical recommendation scorecard

Use only `resolved`, `partially resolved`, `regressed`, or `not exercised` in
the status column. The comparison with the 2026-07-16 evaluation is directional;
do not claim causal performance improvement without a matched historical rerun.

Apply the fixed status thresholds; remediation never contributes to the passing
numerator. Every row must name its preregistered checks and adjudicated episodes.

| # | Historical recommendation | Status | Applicable attempts `N` | Independent domains `D` | First-attempt passes | Evidence IDs/episodes | Remaining risk |
|---:|---|---|---:|---:|---:|---|---|
| 1 | Typed subscription transport | — | — | — | — | — | — |
| 2 | Production adapters and scheduler presets | — | — | — | — | — | — |
| 3 | Separate committed Command outcome from Reaction failure | — | — | — | — | — | — |
| 4 | Focused-test Event catalog ergonomics | — | — | — | — | — | — |
| 5 | Vertical-Slice and persistent-harness generation | — | — | — | — | — | — |
| 6 | Typed projection scaffolding | — | — | — | — | — | — |
| 7 | First-party HTTP/browser template | — | — | — | — | — | — |
| 8 | Explicit subscription start/context semantics | — | — | — | — | — | — |
| 9 | Conformance remediation and propagation tooling | — | — | — | — | — | — |
| 10 | Event/Reaction/projection observability | — | — | — | — | — | — |
| 11 | Idempotency and concurrency primitives | — | — | — | — | — | — |
| 12 | Prominent schema-mode tradeoffs | — | — | — | — | — | — |

## Repeated friction

Call a finding repeated only when it appears independently in at least two
different domains. Two attempts in one domain establish reproducibility, not
transfer. Link every count to frozen logs, diffs, verifier results, or command
artifacts.

Code episodes independently before adjudication. Link both reviewer records,
report category/primary-attribution agreement and Cohen's kappa, and retain
`mixed` or `uncertain` when appropriate.

| Code | Summary | Severity | Independent domains | Attempts | Reviewer agreement | Final attribution | Evidence/adjudication |
|---|---|---|---:|---:|---|---|---|
| `INIT` | — | — | — | — | — | — | — |
| `GEN` | — | — | — | — | — | — | — |
| `MODEL` | — | — | — | — | — | — | — |
| `STATE` | — | — | — | — | — | — | — |
| `REG` | — | — | — | — | — | — | — |
| `PERSIST` | — | — | — | — | — | — | — |
| `REACTION` | — | — | — | — | — | — | — |
| `TRANSPORT` | — | — | — | — | — | — | — |
| `UI` | — | — | — | — | — | — | — |
| `RECOVERY` | — | — | — | — | — | — | — |
| `TEST` | — | — | — | — | — | — | — |
| `TOOL` | — | — | — | — | — | — | — |
| `GUIDE` | — | — | — | — | — | — | — |
| `BRIEF` | — | — | — | — | — | — | — |
| `AGENT` | — | — | — | — | — | — | — |
| `ENV` | — | — | — | — | — | — | — |

## Environment, flake, and adjudication log

| Attempt/check | Initial result | Preregistered environment signature | Reviewer decisions before retry | Retry result | Scoring treatment | Evidence |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — |

| Episode/check | Reviewer A | Reviewer B | Agreement | Adjudicator | Final label/result | Rationale/evidence |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — |

## Descriptive views

Report every domain separately with both repetitions: gate outcomes,
first-attempt and eventual success, active and wall time, iterations, files and
lines changed, generator decisions, source consultations, and friction episodes.
Then show replication/near-transfer and SQLite/PostgreSQL groupings only as
labeled transparency tables. Do not compare rates, medians, ranges, or failure
counts as cohort or profile effects; those assignments are confounded with
domain. Near-transfer recurrence supports only guarded-workflow near-transfer,
not broad generalization.

## Protocol deviations and invalid runs

| Run | Deviation or environment-invalid trigger | Decision time | Frozen evidence | Replacement run | Analysis treatment |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

## Publication checklist

- [ ] Matrix, briefs, prompt, guidance, semantic catalog, and package digests.
- [ ] Candidate-domain rubric table, selection decisions, seed, and blocked run order.
- [ ] Frozen recommendation-evidence map and status denominators.
- [ ] Per-run model/context/prompt/tool/image/browser control metadata.
- [ ] Ten expanded assignments and frozen provenance records.
- [ ] First-attempt repositories, manifests, checkpoint diffs, and raw logs.
- [ ] Visible and held-out check catalogs, drivers, fault cases, and results.
- [ ] Unscored remediation diffs, results, and extra time.
- [ ] Aggregate reports and completed tables above.
- [ ] Unsuccessful and timed-out attempts without omission.
- [ ] Initial and allowed retry runs, invalid runs, replacements, and protocol deviations.
- [ ] Dual-review labels, agreement statistics, and adjudication log.
- [ ] Prioritized recommendations with evidence and known limitations.
