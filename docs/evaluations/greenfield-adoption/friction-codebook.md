# Greenfield Friction Taxonomy Codebook

Use this codebook for independent review of frozen attempt evidence. A friction
episode is one causally connected sequence beginning with a user-visible obstacle
and ending when it is resolved, abandoned, or causes a gate failure. Repeated
symptoms with one diagnosis are one episode; a later recurrence after a verified
resolution is a new episode.

## Required fields

Each episode records attempt and phase, active start/end minute, evidence links,
trigger, observed symptom, diagnosis, workaround, outcome, category, severity,
primary attribution, contributing attributions, and confidence (`high`, `medium`,
or `low`). Reviewers quote commands/errors minimally and link the frozen source.

## Categories

| Code | Category | Include | Exclude or redirect |
|---|---|---|---|
| `INIT` | Initialization | initializer, install layout, generated starter, initial configuration | general package-host outage (`ENV`) |
| `GEN` | Generator output | discoverability, dry-run, generated Slice/harness output, manual adaptation | domain modeling after generation (`MODEL`) |
| `MODEL` | Event and Scenario modeling | Event vocabulary, exact Scenarios, accepted/rejected outcomes | State reconstruction (`STATE`) |
| `STATE` | Private State and projections | decision State, Query projections, catch-up, replay | adapter setup (`PERSIST`) |
| `REG` | App registration | Event/Slice catalogs and application wiring | HTTP exposure (`TRANSPORT`) |
| `PERSIST` | Persistence | SQLite/PostgreSQL adapters, migrations, serialization, durable ordering | projection semantics (`STATE`) |
| `REACTION` | Reactions | scheduler, retries, delivery identity, dead letters, effect Commands | general Command guards (`MODEL`) |
| `TRANSPORT` | Transport and subscriptions | envelopes, JSON boundary, SSE, reconnect, abort cleanup | UI rendering alone (`UI`) |
| `UI` | UI integration | remote client, browser state, user interaction, view composition | server transport defect (`TRANSPORT`) |
| `RECOVERY` | Recovery | restart, service lifecycle, replay repair, injected faults | ordinary persistence setup (`PERSIST`) |
| `TEST` | Testing | harness ergonomics, focused catalogs, flaky app tests | coordinator harness defect (`ENV`) |
| `TOOL` | Toolchain | compiler, linter, bundler, package scripts | Specter generator behavior (`GEN`) |
| `GUIDE` | Guidance | missing, conflicting, or hard-to-find supplied guidance | API defect despite clear guidance (relevant product category) |
| `BRIEF` | Brief ambiguity | two defensible product interpretations change implementation or oracle | ordinary modeling choice (`MODEL`) |
| `AGENT` | General agent/engineering | typo, unrelated coding mistake, ignored explicit instruction | product or guidance-induced error |
| `ENV` | Evaluation environment | coordinator service, browser, cache, host, credential, or harness failure | adopter configuration failure (relevant product/tool category) |

Choose the category at the earliest actionable causal boundary, not the last
command that exposed it. Record downstream categories as contributors when useful.

## Severity

- `blocker`: directly prevents reaching a gate within its fixed time boundary or
  corrupts/scuttles a scored run.
- `major`: costs more than 15 active minutes, causes substantial rework across a
  feature boundary, or requires a non-obvious workaround.
- `minor`: costs at most 15 active minutes and is resolved locally without
  changing the planned architecture.
- `observation`: measurable awkwardness with no material time or gate impact.

Time is supporting evidence, not an override: a fast failure that prevents a gate
is still a blocker.

## Attribution

Assign one primary value:

- `specter-api`: runtime API or type contract;
- `specter-implementation`: package, adapter, scheduler, generator, or transport
  behavior;
- `specter-guidance`: supplied documentation, skill, example, or generated guide;
- `brief`: product specification ambiguity or inconsistency;
- `agent`: general reasoning/coding error despite sufficient materials;
- `environment`: coordinator-owned infrastructure or harness;
- `mixed`: two or more causes are necessary and no single cause dominates;
- `uncertain`: frozen evidence cannot distinguish plausible causes.

Use Specter attribution only when the evidence identifies a Specter boundary and
a counterfactual is stated: what frozen API, behavior, generator output, or
guidance change would likely have prevented the episode? The existence of Specter
code in the causal chain is insufficient. A workaround is not automatically
evidence of a Specter defect.

## Independent review and repetition

Two reviewers code every episode independently before discussion. The third
reviewer resolves disagreements under the methodology adjudication rule. Report
agreement before adjudication.

Multiple episodes in one attempt count separately for qualitative analysis but
only once per category when reporting the number of affected attempts. A finding
is repeated only when substantively equivalent causal episodes occur in at least
two independent domains. Two repetitions in one domain establish reproducibility,
not transfer.
