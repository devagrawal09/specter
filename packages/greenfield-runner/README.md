# Specter Greenfield Evaluation Runner

Coordinator-side, append-only orchestration for the ten-attempt greenfield
adoption evaluation. The package deliberately does not know Specter internals.
It runs visible and held-out verifier commands through a small `CommandRunner`
interface, records evidence, and reports the four cumulative evaluation gates.

## Safety model

- Attempt IDs are `<domain-id>-<1|2>` and are created below an explicit attempts
  root. Preparing an existing attempt always fails.
- Paths in matrix entries are validated relative paths. Freeze paths may not
  overlap or escape the attempt. Commands use an executable plus an argument
  array with `shell: false`; command-shell executables are rejected.
- Every command has an explicit timeout. Visible commands must run before
  held-out commands.
- A successful held-out command set must write the coordinator verifier result
  to `workspace/specter-evaluation/verifier-result.json` in its disposable
  verification copy. Gate reports are derived from that signed-off result, not
  from adopter readiness markers or command exit status alone.
- The scored workspace is copied to `first-attempt/artifacts` before any
  verification or remediation. Symlinks are prohibited throughout every frozen
  artifact tree. Each verifier suite runs against its own fresh
  `verification/<suite>/artifacts` copy whose manifest must match the freeze,
  and the original freeze is re-hashed afterward. Existing frozen artifacts,
  suite workspaces, and results are never overwritten.
- Active work uses explicit start/stop sessions and a fixed 10,800,000ms
  (180-minute) limit. Markers after the limit become `time-expired`; the report
  can never classify such an attempt as a first-attempt success. Coordinators
  use `enforceActiveLimit` to invoke their agent/process termination callback at
  the limit instead of waiting for a later marker.

## Inputs

Prepare takes one matrix entry and one provenance record. JSON schemas live in
`schemas/`. TypeScript callers should use `validateMatrixEntry` and
`validateProvenance`, which additionally enforce cross-field rules:

- SQLite is single-process; Postgres is multi-process.
- `attemptId` agrees with the domain and repetition number.
- command IDs are unique across visible and held-out suites.
- package names and freeze paths are unique.
- the workspace path is itself one of the frozen paths.

All hashes are lowercase SHA-256 strings. `semanticCatalogSha256` identifies the
visible frozen semantic catalog; the app-owned semantic adapter is included in
the workspace freeze while held-out oracles remain private. Package arrays and
environment keys are normalized into deterministic order before provenance is
frozen.

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

`buildFrozenProvenance` reads and hashes the prompt, every identified guidance
file, domain brief, visible semantic catalog, verifier artifact, and each packed
Specter package. Callers supply paths, package identities, model metadata, and
optionally expected digests; they do not supply the recorded digests. Any
expected digest mismatch fails before attempt preparation. Inputs must be
regular non-symlink files. The combined guidance digest is the SHA-256 of the
canonical, ID-sorted guidance-file digest list.

## Coordinator runbook

Build the package and invoke `dist/cli.js` (or the installed
`specter-greenfield` binary):

```sh
specter-greenfield prepare \
  --attempts-root /evaluation/attempts \
  --assignment /evaluation/matrix/emergency-department-1.json \
  --provenance /evaluation/frozen-provenance.json

specter-greenfield timer-start \
  --attempt /evaluation/attempts/emergency-department-1

specter-greenfield mark \
  --attempt /evaluation/attempts/emergency-department-1 \
  --kind bootstrap --outcome passed

specter-greenfield mark \
  --attempt /evaluation/attempts/emergency-department-1 \
  --kind checkpoint --outcome passed

specter-greenfield freeze \
  --attempt /evaluation/attempts/emergency-department-1 \
  --outcome passed

specter-greenfield verify \
  --attempt /evaluation/attempts/emergency-department-1 --suite visible

specter-greenfield verify \
  --attempt /evaluation/attempts/emergency-department-1 --suite held-out

specter-greenfield report \
  --attempt /evaluation/attempts/emergency-department-1

specter-greenfield remediation-start \
  --attempt /evaluation/attempts/emergency-department-1

# After the unscored repair and verifier rerun outside the frozen tree:
specter-greenfield remediation-finish \
  --attempt /evaluation/attempts/emergency-department-1 \
  --result /evaluation/remediation/emergency-department-1/verifier-result.json

specter-greenfield aggregate --attempts-root /evaluation/attempts

specter-greenfield expand-catalog --catalog /evaluation/catalog.json
specter-greenfield validate-matrix --matrix /evaluation/matrix.json
specter-greenfield adopter-assignment \
  --matrix /evaluation/matrix.json --attempt-id emergency-department-1
specter-greenfield build-provenance --config /evaluation/provenance-input.json
```

`freeze` stops a running active timer. For an intentional pause before final
freeze, use `timer-stop`, then `timer-start` when work resumes. Use `failed` or
`time-expired` outcomes to preserve unsuccessful attempts; never remove them.
Start an `enforceActiveLimit` watchdog after every `timer-start`; cancel it when
the timer is intentionally stopped. `setupWallMs` ends at the first timer start,
and `scoredWallMs` begins there, so pre-attempt coordinator delay is not scored.

The remediation finish command copies and hashes a completed verifier result,
derives eventual success from it, and reports elapsed remediation wall time
separately; it never changes scored gates. The final-freeze outcome records whether the complete app appeared ready at the
end of scored work. Domain completeness additionally requires the visible suite
to pass. Robustness requires all earlier gates plus the held-out suite.

## Evidence layout

```text
<attempt>/
  frozen-provenance.json
  state.json
  workspace/
  logs/chronology.jsonl
  logs/commands/*.stdout.log
  logs/commands/*.stderr.log
  first-attempt/artifacts/
  first-attempt/manifest.json
  verification/visible/artifacts/
  verification/held-out/artifacts/
  visible-results.json
  held-out-results.json
  attempt-report.json
```

The manifest hashes every frozen regular file and records directory and symlink
entries. `aggregate-report.json` sorts attempts by ID and reports replication
versus transfer domains and SQLite versus Postgres profiles separately.

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
