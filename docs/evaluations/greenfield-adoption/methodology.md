# Greenfield Evaluation Preregistered Methodology

This document fixes the evaluation's design and decision rules before any scored
attempt begins. The matrix, prompt, harness, and analysis must follow it. Any
post-freeze deviation is reported as a protocol deviation; it is not silently
repaired.

## Inference boundary

The five domains are deliberately heterogeneous and the persistence profiles are
assigned by domain rather than randomized within domain. PostgreSQL is therefore
confounded with domain, and the replication/near-transfer cohorts are also
confounded with domain and persistence. Results are descriptive at the domain and
attempt level.

Do not estimate or imply a PostgreSQL-versus-SQLite effect, a
replication-versus-near-transfer effect, or an interaction between them. Separate
tables are useful for transparency, not causal comparison. Such effect claims
require a redesigned matrix that independently randomizes or crosses profile and
cohort assignment within enough domains, with sample size and analysis fixed in
advance.

The two added domains are **near-transfer domains**. They test whether findings
recur in unfamiliar vocabulary with the same broad guarded-workflow shape; they
do not establish transfer to arbitrary application categories, scales, teams, or
production environments.

## Near-transfer-domain selection rubric

Before scoring, the coordinator records every candidate considered and scores it
independently by two reviewers from `0` (absent), `1` (weak), or `2` (strong) on:

1. at least two meaningful state-dependent rejection guards;
2. a natural idempotency or optimistic-concurrency race;
3. a natural asynchronous effect that dispatches a guarded Command;
4. a live operational view updated by another request or Reaction;
5. meaningful restart, replay, catch-up, and recovery behavior;
6. two coherent browser journeys containing both success and guarded failure;
7. vocabulary and business-process distance from the three replication domains;
8. absence from shipped Specter examples and supplied guidance.

A candidate is eligible only if it scores `2` on criteria 1–6, at least `1` on
criterion 7, and `2` on criterion 8. Ties are resolved by the higher criterion-7
score, then by a seeded random draw. Reviewers resolve scoring disagreements
before the draw and publish the candidate table, exclusions, seed, and draw.
Aircraft turnaround and municipal water restoration are fixed as the selected
near-transfer domains for this evaluation. If the frozen pre-scoring candidate
table cannot show that they satisfy the rubric without changing a brief, scoring
must not begin.

Materialize and freeze this table before scoring; add rows for every candidate,
including exclusions:

| Candidate | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Eligible | Selected or exclusion reason |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| Aircraft turnaround | — | — | — | — | — | — | — | — | — | — |
| Municipal water restoration | — | — | — | — | — | — | — | — | — | — |

## Run order and execution controls

Use two randomized blocks. Each block contains exactly one attempt from each of
the five domains. Before any attempt, generate and publish one seed, randomize
domain order independently inside each block, and designate the first occurrence
of each domain as attempt 1 and the second as attempt 2. Run block 1 completely
before block 2. Do not reorder a difficult, failed, or delayed attempt except
under the environment-invalid policy below; preserve its original slot in the
published schedule.

| Seed | Block | Position | Domain | Attempt ID |
|---|---:|---:|---|---|
| — | 1 | — | — | — |
| — | 2 | — | — | — |

Every attempt uses a new agent task with no prior evaluation conversation,
memory, summary, or delegated agent. Record and require equality across attempts
for:

- exact model identifier, provider snapshot/build identifier, and reasoning
  setting;
- system and developer prompt digests, context-window limit, and tool-policy
  digest;
- adopter prompt, supplied skill/guidance, reference apps, packed packages,
  visible suite, and prepared-environment digests;
- browser name, exact revision, operating-system image, CPU/memory limits, and
  dependency-cache snapshot.

Record the fresh task ID and initial context token count. If the model snapshot,
prompt controls, or execution image changes, stop the evaluation. Resume only as
a separately labeled cohort or restart all scored attempts under one frozen
control set; never pool unlike controls.

## Active-time clock and setup boundary

The coordinator provisions the operating-system image, package cache, browser,
empty database service, credentials, fixed port, local package tarballs, and
empty attempt parent before active time starts. It must not initialize the app,
create app tables, apply app migrations, or make domain choices.

Active time starts immediately before the adopter receives control for its first
command. Initializer execution, dependency installation from the prepared cache,
app configuration, authoring or generating migrations, applying app migrations,
starter validation, implementation, tests, builds, diagnosis, browser work, and
agent idle time all consume active time. The same boundary applies to SQLite and
PostgreSQL. Coordinator-only service creation and credential injection happen
before the clock; adopter-triggered migration and application setup happen after
it.

The checkpoint phase has a fixed ceiling of **75 active minutes**. If the adopter
declares `CHECKPOINT_READY` earlier, the coordinator pauses, captures the
checkpoint, and sends procedural `CONTINUE`. Otherwise, at 75 minutes the
coordinator automatically pauses and captures the current checkpoint as failed
or incomplete, then sends the same `CONTINUE` without findings or advice. Phase 2
receives the remaining active-time budget; unused checkpoint time carries forward,
but phase 1 may never consume more than 75 minutes. Total first-attempt work stops
at 180 active minutes.

### Automatic pause allowlist

Only the coordinator can pause the active clock, and only for one of these
machine-recorded reasons:

- `checkpoint-capture`: from `CHECKPOINT_READY` or the 75-minute ceiling until
  the unchanged `CONTINUE` signal;
- `coordinator-service-recovery`: a prepared database, browser, package cache,
  credential, or fixed-port facility fails independently of adopter changes;
- `coordinator-approval`: waiting for a pre-authorized coordinator action that
  the adopter cannot perform;
- `final-freeze`: after `FINAL_READY`, `TIME_EXPIRED`, or watchdog termination.

Each pause records monotonic start/end times, reason, triggering evidence, and
coordinator action. Installs, migrations, commands, tests, builds, adopter
diagnosis, adopter-requested waiting, agent inactivity, and failures caused by app
configuration are never paused. Verification and remediation have their own
clocks and never alter first-attempt active time.

## Verification, flakes, and environment failures

Run each frozen visible check once, then each held-out check once, in the
preregistered order and clean per-check environment. Preserve every invocation.

- An assertion mismatch, timeout, crash, nondeterministic app result, leaked
  internal error, dirty cleanup, or unexplained failure is an application/harness
  result and is not retried for scoring.
- A retry is allowed only when a preregistered environment signature proves that
  the coordinator-owned service, browser process, package cache, host, or
  credential failed independently of app behavior. Two reviewers must agree
  before seeing the retry outcome. After a clean reset, run exactly one retry.
- If that retry passes, use it for the gate but retain and label both runs
  `environment-affected`. If it fails differently or repeats without the exact
  environment signature, the check fails and is labeled nondeterministic.
- A visible or held-out pass followed by an unexplained failure is a failure; do
  not take the best of repeated results.
- If a coordinator outage prevents meaningful work for more than 20 wall minutes
  in one incident or 40 wall minutes cumulatively, terminate the attempt as
  `environment-invalid`. It is excluded from the two scored repetitions and
  rerun in a fresh context at the end of the same block under identical frozen
  controls. Publish both the invalid run and replacement.

No check, expectation, brief, adapter contract, or package may change through
this policy. A harness defect discovered after scoring starts pauses the entire
evaluation for adjudication; affected attempts are not selectively repaired.

## Adjudication and attribution

Two reviewers independently review every first-attempt failure and every friction
episode using `friction-codebook.md`. Reviewers see frozen evidence but not the
other reviewer's labels. They assign phase, category, severity, primary
attribution, contributing attributions, confidence, and causal chain. Report raw
agreement and Cohen's kappa for category and primary attribution.

Disagreements are resolved by a predesignated third reviewer using only frozen
evidence and the codebook. The adjudication log preserves both original labels,
the final label, rationale, and evidence links. Ambiguous causality remains
`mixed` or `uncertain`; it is never forced into Specter attribution. Adjudication
may relabel evidence but may not change a check result, rerun a check, or edit an
attempt.

## Remediation

After first-attempt results are immutable, give the same agent all findings and a
fixed **60 active-minute** unscored remediation window. Apply the same automatic
pause allowlist and environment policy, with a separate timer and log. Stop when
all checks pass or 60 active minutes expires. Run one clean visible-then-held-out
verification under the same retry rules. Report eventual success, active time,
wall time, iterations, and changes separately; remediation never changes any
first-attempt gate or rate.

## Historical-recommendation status rules

Before scoring, freeze a recommendation-evidence map naming each recommendation,
the check IDs and friction categories that exercise it, applicable domains, and
the historical capability used for directional comparison. Do not add evidence
to a map after results are visible. Determine status only from those
preregistered checks and adjudicated friction. Let `N` be applicable first
attempts and `D` the number of independent applicable domains.

- **Not exercised:** `D < 2`, or the frozen checks do not directly exercise the
  recommendation's promised behavior.
- **Resolved:** `D >= 2`, at least `ceil(0.80 * N)` applicable attempts pass the
  mapped first-attempt evidence, every applicable domain has at least one pass,
  and there is no repeated Specter-attributed blocker or major friction episode
  in two independent domains.
- **Regressed:** in at least two independent replication domains, mapped behavior
  that the historical evaluation covered now fails or requires new
  Specter-attributed blocker/major friction. Near-transfer failures alone cannot
  establish historical regression.
- **Partially resolved:** directly exercised with `D >= 2` but neither the
  resolved nor regressed rule is met.

Publish `N`, `D`, the passing numerator, evidence IDs, and friction episodes for
every status. Remediation may be discussed as eventual usability evidence but is
not used in these thresholds.
