# Specter Greenfield Evaluation Runner

Coordinator-side, append-only orchestration for the ten-attempt greenfield
adoption evaluation. The package deliberately does not know Specter internals.
It runs visible and held-out verifier commands through a small `CommandRunner`
interface, records evidence, and reports the four cumulative evaluation gates.

## Safety model

- Attempt IDs are `<domain-id>-<1|2>`. Private state is created below an
  explicit coordinator root and adopter-writable files below a physically
  separate adopter root. Preparing either side of an existing attempt fails.
- Paths in matrix entries are validated relative paths. Freeze paths may not
  overlap or escape the attempt. Commands use an executable plus an argument
  array with `shell: false`; command-shell executables are rejected.
- Every command has an explicit timeout. Visible commands must run before
  held-out commands.
- Every held-out phase command set must write the coordinator verifier result
  to `workspace/specter-evaluation/verifier-result.json` in its disposable
  verification copy. Exit `0` means all gates passed; exit `1` is a valid
  verifier completion with partial gates. Exit `2`, timeout, a missing/invalid
  result, or a binding mismatch is a harness failure.
- `mark bootstrap` and `mark checkpoint` create immutable phase snapshots;
  `freeze` creates the immutable final snapshot. Held-out verification runs
  independently against all three and takes bootstrap only from the bootstrap
  snapshot, vertical-path only from checkpoint, and the final two gates only
  from final. Later work therefore cannot retroactively pass an earlier gate.
  Symlinks are prohibited throughout every frozen artifact tree. Each verifier
  run uses a fresh `verification/<suite>/<phase>/artifacts` copy,
  whose manifest must match its phase snapshot,
  and the original freeze is re-hashed afterward. Existing frozen artifacts,
  suite workspaces, and results are never overwritten.
- The runner injects attempt, prepared-config, phase, and snapshot digests into
  held-out command environments. The verifier CLI copies those values plus the
  SHA-256 of its verification plan into `coordinatorBinding`; the runner checks
  the binding, attempt descriptor, gate set, and result consistency before
  copying and hashing the result outside the disposable workspace.
- Active work uses explicit start/stop sessions and a fixed 10,800,000ms
  (180-minute) limit. Markers after the limit become `time-expired`; the report
  can never classify such an attempt as a first-attempt success. Coordinators
  run the `supervise` command against the adopter process group for both the
  75-minute checkpoint ceiling and 180-minute total limit.

The coordinator root and adopter root are separate siblings or separate mounts;
neither may contain the other. Never place `frozen-provenance.json`, full matrix
entries, runner state, held-out commands, or private-kit artifacts above an
adopter-writable workspace. Before scoring, run `rehearse-isolation` from inside
the actual adopter sandbox using public and private canary paths. The contract
must name the prepared attempt ID, config digest, exact private attempt root,
and exact public adopter root. A readable private canary fails the rehearsal.
Capture the JSON result outside the sandbox and persist it with
`record-isolation`; timer start and verification refuse missing, failing,
replayed, root-mismatched, or config-mismatched attestations.

## Inputs

Prepare takes one matrix entry and one provenance record. JSON schemas live in
`schemas/`. TypeScript callers should use `validateMatrixEntry` and
`validateProvenance`, which additionally enforce cross-field rules:

- SQLite is single-process; Postgres is multi-process.
- `attemptId` agrees with the domain and repetition number.
- command IDs are unique across visible and held-out suites.
- package names and freeze paths are unique.
- the workspace path is itself one of the frozen paths.

All hashes are lowercase SHA-256 strings. `artifacts` is a canonical ID-sorted
manifest whose audience marks each input `public` or `private`; its aggregate
digest is `artifactManifestSha256`. Required kinds cover the adopter prompt,
brief, guidance, initializer, semantic catalog/map contract, Specter packages,
visible suite, check catalog/cases/plans, coordinator driver, execution catalog,
runner/verifier, service/browser fixtures, and held-out suite. Runtime provenance
also fixes the model build/sampler, agent harness, OS/architecture, Node/package
manager, browser revision, services, and run-order seed. It also freezes the
methodology, friction codebook, candidate table, exact randomized schedule,
recommendation evidence map, environment-failure signatures, reviewer
assignment, and system/developer/tool policies. Runtime controls include the
exact ten-attempt order, unique fresh-task records, execution-image digest,
context/CPU/memory/time limits, image-input digests, and dependency-cache digest.

## Catalog expansion and audience boundary

`expandCoordinatorCatalog` converts a validated five-domain catalog into the
ten full coordinator assignments. It requires two attempts for each domain,
three replication plus two transfer domains, three SQLite plus two Postgres
domain profiles, and one unique fixed five-digit port per domain. SQLite and
Postgres topology is derived rather than supplied.

Visible and held-out command templates are explicit executable/argument arrays.
The supported substitutions are `{attemptId}`, `{attemptNumber}`, `{domainId}`,
`{domainKind}`, `{persistence}`, `{port}`, `{topology}`, and `{workspacePath}`.
Unknown substitutions fail expansion. `validateCompleteMatrix` independently
audits an expanded matrix before execution.

The expanded matrix is coordinator-private because it contains held-out
commands. Produce adopter input only with `toAdopterAssignment` or the
`adopter-assignment` CLI command. That projection is a distinct TypeScript type
and omits `heldOutCommands` entirely.

## Provenance construction

`buildFrozenProvenance` hashes every identified public/private artifact and each
packed Specter package. Callers supply artifact paths and runtime identities, not
the recorded digests. Any expected digest mismatch fails before preparation.
Inputs must be regular non-symlink files. Package entries must reference their
matching public `specterPackage` artifact.

## Coordinator runbook

Build the package and invoke `dist/cli.js` (or the installed
`specter-greenfield` binary):

```sh
specter-greenfield prepare \
  --coordinator-root /evaluation/private/attempts \
  --adopter-root /evaluation/public/attempts \
  --assignment /evaluation/matrix/emergency-department-1.json \
  --provenance /evaluation/frozen-provenance.json

# Run in the actual adopter sandbox, capture stdout coordinator-side, then
# persist the passing result in the exact private attempt directory.
specter-greenfield rehearse-isolation \
  --contract /evaluation/public/attempts/emergency-department-1/isolation-contract.json \
  > /evaluation/private/isolation-result.json
specter-greenfield record-isolation \
  --attempt /evaluation/private/attempts/emergency-department-1 \
  --result /evaluation/private/isolation-result.json

specter-greenfield timer-start \
  --attempt /evaluation/private/attempts/emergency-department-1

# Every pause must use a protocol allowlist reason and durable audit evidence.
specter-greenfield timer-stop \
  --attempt /evaluation/private/attempts/emergency-department-1 \
  --reason coordinator-service-recovery \
  --trigger-evidence 'postgres health signature db-reset-17' \
  --coordinator-action 'restarted the prepared database service'
specter-greenfield timer-start \
  --attempt /evaluation/private/attempts/emergency-department-1

# Run these independently against the adopter process-group leader PID.
specter-greenfield supervise \
  --attempt /evaluation/private/attempts/emergency-department-1 \
  --pid 12345 --limit checkpoint
specter-greenfield supervise \
  --attempt /evaluation/private/attempts/emergency-department-1 \
  --pid 12345 --limit active

specter-greenfield mark \
  --attempt /evaluation/private/attempts/emergency-department-1 \
  --kind bootstrap --outcome passed

specter-greenfield mark \
  --attempt /evaluation/private/attempts/emergency-department-1 \
  --kind checkpoint --outcome passed

specter-greenfield freeze \
  --attempt /evaluation/private/attempts/emergency-department-1 \
  --outcome passed

specter-greenfield verify \
  --attempt /evaluation/private/attempts/emergency-department-1 --suite visible

specter-greenfield verify \
  --attempt /evaluation/private/attempts/emergency-department-1 --suite held-out

specter-greenfield report \
  --attempt /evaluation/private/attempts/emergency-department-1

specter-greenfield remediation-start \
  --attempt /evaluation/private/attempts/emergency-department-1

# Run independently against the remediation process-group leader. The
# supervisor terminates and freezes remediation at 60 active minutes.
specter-greenfield supervise \
  --attempt /evaluation/private/attempts/emergency-department-1 \
  --pid 12346 --limit remediation

# After the unscored repair, freeze it before running the verifier:
specter-greenfield remediation-freeze \
  --attempt /evaluation/private/attempts/emergency-department-1

# Run the verifier against remediation/artifacts with the binding environment
# returned by the coordinator state, then record that exact result:
specter-greenfield remediation-finish \
  --attempt /evaluation/private/attempts/emergency-department-1 \
  --result /evaluation/remediation/emergency-department-1/verifier-result.json

specter-greenfield aggregate \
  --attempts-root /evaluation/private/attempts \
  --matrix /evaluation/matrix.json

specter-greenfield expand-catalog --catalog /evaluation/catalog.json
specter-greenfield validate-matrix --matrix /evaluation/matrix.json
specter-greenfield adopter-assignment \
  --matrix /evaluation/matrix.json --attempt-id emergency-department-1
specter-greenfield build-provenance --config /evaluation/provenance-input.json
specter-greenfield rehearse-isolation --contract FILE
specter-greenfield record-isolation --attempt DIR --result FILE
```

`freeze` stops a running active timer with a `final-freeze` audit record. For an
intentional pause before final freeze, `timer-stop` requires `--reason`,
`--trigger-evidence`, and `--coordinator-action`; the reason must be
`checkpoint-capture`, `coordinator-service-recovery`, `coordinator-approval`, or
`final-freeze`. `timer-start` closes the persisted pause interval when work
resumes. Remediation has corresponding `remediation-timer-stop` and
`remediation-timer-start` commands and a distinct 60-active-minute timer. Use
`failed` or `time-expired` outcomes to preserve unsuccessful attempts; never
remove them.
Start both first-attempt `supervise` processes after `timer-start`. On a recorded
checkpoint or at 75 active minutes, the checkpoint supervisor terminates active
editing, captures a time-expired checkpoint at the ceiling when bootstrap exists,
and persists a `checkpoint-capture` pause. The coordinator sends the unchanged
`CONTINUE`, calls `timer-start`, and restarts the adopter process as needed. The
active supervisor terminates at final freeze or 180 active minutes. `setupWallMs`
ends at the first timer start, and `scoredWallMs` begins there, so pre-attempt
coordinator delay is not scored.

The remediation finish command requires the remediation snapshot, exact attempt
and coordinator binding, a complete four-gate remediation phase, and an
`eventualSuccess` value consistent with those gates. It copies and hashes the
result and reports elapsed remediation wall time separately; it never changes
scored gates. The final-freeze outcome records whether the complete app appeared ready at the
end of scored work. Domain completeness additionally requires the visible suite
to pass. Robustness requires all earlier gates plus the held-out suite.

## Evidence layout

```text
<coordinator-root>/<attempt>/
  frozen-provenance.json
  isolation-attestation.json
  state.json
  logs/chronology.jsonl
  logs/commands/*.stdout.log
  logs/commands/*.stderr.log
  phase-snapshots/bootstrap/{artifacts/,manifest.json}
  phase-snapshots/checkpoint/{artifacts/,manifest.json}
  first-attempt/artifacts/
  first-attempt/manifest.json
  verification/visible/final/artifacts/
  verification/held-out/{bootstrap,checkpoint,final}/artifacts/
  verifier-results/held-out/{bootstrap,checkpoint,final}.json
  visible-results.json
  held-out-results.json
  attempt-report.json

<adopter-root>/<attempt>/
  adopter-assignment.json
  workspace/
```

The manifest hashes every frozen regular file and records directory and symlink
entries. Aggregation requires the preregistered matrix, exactly its ten attempt
IDs, complete bound held-out results, and identical shared controls. It rejects
missing/extra runs or provenance drift before writing `aggregate-report.json`.
It also requires a bound passing isolation attestation for every attempt,
recorded active-time starts in the exact frozen two-block order, and one unique
fresh task/context record for each matrix attempt.

## Library integration

Use `prepareAttempt`, `startActiveTime`, `recordMarker`,
`enforceActiveLimit`, `freezeFirstAttempt`, `runVerificationSuite`, and
`beginRemediation` for a custom coordinator. `runVerificationSuite` accepts a `CommandRunner`; connect a remote
executor or container runtime by implementing:

```ts
interface CommandRunner {
  run(request: CommandExecutionRequest): Promise<CommandExecutionResult>
}
```

The interface receives a validated command, an absolute working directory
inside a disposable verification copy of the frozen artifacts, and its timeout. It returns captured output,
exit status, timing, and timeout state. This keeps app-specific visible and
held-out harnesses outside the coordinator package.
