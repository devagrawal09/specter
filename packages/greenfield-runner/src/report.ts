import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { validateCompleteMatrix } from './coordinator.js'
import { assertPassingIsolationAttestation } from './isolation.js'
import { resolveBelow, sha256, stableJson, writeJsonAtomic } from './storage.js'
import {
  activeElapsedMs,
  type Clock,
  loadPrepared,
  loadState,
} from './runner.js'
import type {
  AggregateGroup,
  AggregateReport,
  AttemptMarker,
  AttemptReport,
  FrozenArtifactProvenance,
  GateOutcome,
  MatrixEntry,
  PreparedAttempt,
} from './types.js'
import { validateProvenance } from './validation.js'

const systemClock: Clock = { now: () => new Date() }

const domainSpecificArtifactKinds = new Set<FrozenArtifactProvenance['kind']>([
  'browserFixture',
  'checkCases',
  'domainBrief',
  'heldOutSuite',
  'serviceFixture',
  'verificationPlan',
  'visibleSuite',
])

export function buildAttemptReport(
  attemptDirectory: string,
  clock: Clock = systemClock,
): AttemptReport {
  const prepared = loadPrepared(attemptDirectory)
  const state = loadState(attemptDirectory)
  const elapsed = activeElapsedMs(state, clock)
  const verified = state.suites['held-out']?.verifierGates
  const bootstrapMarker = findMarker(state.markers, 'bootstrap')
  const checkpointMarker = findMarker(state.markers, 'checkpoint')
  const finalMarker = findMarker(state.markers, 'final-freeze')
  const visiblePassed = state.suites.visible?.passed === true
  const heldOutHarnessPassed =
    state.suites['held-out'] !== undefined &&
    state.suites['held-out'].harnessFailure === undefined
  const bootstrapPassed =
    bootstrapMarker?.outcome === 'passed' && verified?.bootstrap === true
  const verticalPathPassed =
    bootstrapPassed &&
    checkpointMarker?.outcome === 'passed' &&
    verified?.verticalPath === true
  const domainCompletenessPassed =
    verticalPathPassed && visiblePassed && verified?.domainCompleteness === true
  const robustnessPassed =
    domainCompletenessPassed &&
    heldOutHarnessPassed &&
    verified?.robustness === true
  const bootstrap = verified ? gateOutcome(bootstrapPassed) : 'not-reached'
  const verticalPath = verified
    ? gateOutcome(verticalPathPassed)
    : 'not-reached'
  const domainCompleteness = verified
    ? gateOutcome(domainCompletenessPassed)
    : 'not-reached'
  const robustness = verified ? gateOutcome(robustnessPassed) : 'not-reached'
  const gates = {
    bootstrap,
    verticalPath,
    domainCompleteness,
    robustness,
  }
  const firstSession = state.timer.sessions[0]
  const firstActiveStartedAt =
    firstSession?.startedAt ?? state.timer.runningSince ?? null
  const setupWallMs = firstSession
    ? Math.max(
        0,
        Date.parse(firstSession.startedAt) - Date.parse(state.preparedAt),
      )
    : state.timer.runningSince
      ? Math.max(
          0,
          Date.parse(state.timer.runningSince) - Date.parse(state.preparedAt),
        )
      : null
  const remediationExtraWallMs = state.remediation?.finishedAt
    ? Math.max(
        0,
        Date.parse(state.remediation.finishedAt) -
          Date.parse(state.remediation.startedAt),
      )
    : null

  return {
    schemaVersion: 1,
    attemptId: prepared.assignment.attemptId,
    domainId: prepared.assignment.domainId,
    domainName: prepared.assignment.domainName,
    domainKind: prepared.assignment.domainKind,
    attemptNumber: prepared.assignment.attemptNumber,
    persistence: prepared.assignment.persistence,
    topology: prepared.assignment.topology,
    port: prepared.assignment.port,
    configSha256: prepared.configSha256,
    activeLimitMs: state.timer.limitMs,
    activeElapsedMs: elapsed,
    activeLimitExceeded: elapsed > state.timer.limitMs,
    timing: {
      setupWallMs,
      bootstrapActiveMs: bootstrapMarker?.activeElapsedMs ?? null,
      verticalPathActiveMs:
        checkpointMarker && bootstrapMarker
          ? Math.max(
              0,
              checkpointMarker.activeElapsedMs -
                bootstrapMarker.activeElapsedMs,
            )
          : null,
      fullAppActiveMs:
        finalMarker && checkpointMarker
          ? Math.max(
              0,
              finalMarker.activeElapsedMs - checkpointMarker.activeElapsedMs,
            )
          : null,
      totalActiveMs: elapsed,
      scoredWallMs: finalMarker
        ? firstActiveStartedAt
          ? Math.max(
              0,
              Date.parse(finalMarker.recordedAt) -
                Date.parse(firstActiveStartedAt),
            )
          : null
        : null,
    },
    gates,
    fullFirstAttemptSuccess:
      !state.timer.runningSince &&
      elapsed <= state.timer.limitMs &&
      state.suites.visible?.passed === true &&
      state.suites['held-out']?.passed === true &&
      Object.values(gates).every((gate) => gate === 'passed'),
    frozen: Boolean(state.freeze),
    visibleVerificationPassed: state.suites.visible?.passed ?? null,
    heldOutVerificationPassed: state.suites['held-out']?.passed ?? null,
    remediation: {
      started: Boolean(state.remediation),
      finished: Boolean(state.remediation?.finishedAt),
      eventualSuccess: state.remediation?.outcome
        ? state.remediation.outcome === 'passed'
        : null,
      extraWallMs: remediationExtraWallMs,
    },
  }
}

export function writeAttemptReport(
  attemptDirectory: string,
  clock: Clock = systemClock,
): AttemptReport {
  const report = buildAttemptReport(attemptDirectory, clock)
  writeJsonAtomic(
    join(resolve(attemptDirectory), 'attempt-report.json'),
    report,
  )
  return report
}

export function discoverAttemptDirectories(attemptsRoot: string): string[] {
  const root = resolve(attemptsRoot)
  return readdirSync(root)
    .sort()
    .map((entry) => join(root, entry))
    .filter(
      (entry) =>
        existsSync(join(entry, 'state.json')) &&
        existsSync(join(entry, 'frozen-provenance.json')),
    )
}

export function buildAggregateReport(
  attemptDirectories: readonly string[],
  expectedMatrixValue: unknown,
  clock: Clock = systemClock,
): AggregateReport {
  const expectedMatrix = validateCompleteMatrix(expectedMatrixValue)
  const preparedAttempts = validateAggregateInputs(
    attemptDirectories,
    expectedMatrix,
  )
  const attempts = preparedAttempts
    .map(({ directory }) => buildAttemptReport(directory, clock))
    .sort((left, right) => left.attemptId.localeCompare(right.attemptId))

  return {
    schemaVersion: 1,
    attempts,
    totals: group(attempts),
    byDomainKind: {
      replication: group(
        attempts.filter((attempt) => attempt.domainKind === 'replication'),
      ),
      transfer: group(
        attempts.filter((attempt) => attempt.domainKind === 'transfer'),
      ),
    },
    byPersistence: {
      sqlite: group(
        attempts.filter((attempt) => attempt.persistence === 'sqlite'),
      ),
      postgres: group(
        attempts.filter((attempt) => attempt.persistence === 'postgres'),
      ),
    },
  }
}

export function writeAggregateReport(
  attemptsRoot: string,
  expectedMatrix: unknown,
  clock: Clock = systemClock,
): AggregateReport {
  const root = resolve(attemptsRoot)
  const report = buildAggregateReport(
    discoverAttemptDirectories(root),
    expectedMatrix,
    clock,
  )
  writeJsonAtomic(join(root, 'aggregate-report.json'), report)
  return report
}

function validateAggregateInputs(
  attemptDirectories: readonly string[],
  expectedMatrix: readonly MatrixEntry[],
): readonly { directory: string; prepared: PreparedAttempt }[] {
  const preparedAttempts = attemptDirectories.map((directory) => {
    const absoluteDirectory = resolve(directory)
    const prepared = loadPrepared(absoluteDirectory)
    const provenance = validateProvenance(prepared.provenance)
    const expectedConfigSha256 = sha256(
      stableJson({ assignment: prepared.assignment, provenance }),
    )
    if (prepared.configSha256 !== expectedConfigSha256) {
      throw new Error(
        `Attempt ${prepared.assignment.attemptId} has a frozen config digest mismatch`,
      )
    }
    return {
      directory: absoluteDirectory,
      prepared: { ...prepared, provenance },
    }
  })
  const expectedIds = expectedMatrix.map((entry) => entry.attemptId).sort()
  const actualIds = preparedAttempts
    .map(({ prepared }) => prepared.assignment.attemptId)
    .sort()
  const expectedIdSet = new Set(expectedIds)
  const actualIdSet = new Set(actualIds)
  const missing = expectedIds.filter((attemptId) => !actualIdSet.has(attemptId))
  const extra = actualIds.filter(
    (attemptId, index) =>
      !expectedIdSet.has(attemptId) || actualIds.indexOf(attemptId) !== index,
  )
  if (missing.length > 0 || extra.length > 0) {
    const details = [
      missing.length > 0 ? `missing: ${missing.join(', ')}` : undefined,
      extra.length > 0 ? `unexpected: ${extra.join(', ')}` : undefined,
    ].filter(Boolean)
    throw new Error(
      `Aggregate attempt IDs do not match the matrix (${details.join('; ')})`,
    )
  }

  const expectedById = new Map(
    expectedMatrix.map((entry) => [entry.attemptId, entry]),
  )
  for (const attempt of preparedAttempts) {
    const attemptId = attempt.prepared.assignment.attemptId
    const expected = expectedById.get(attemptId)
    if (
      !expected ||
      stableJson(attempt.prepared.assignment) !== stableJson(expected)
    ) {
      throw new Error(
        `Attempt ${attemptId} assignment drifted from the expected matrix`,
      )
    }
    assertPassingIsolationAttestation(attempt.directory)
    validateHeldOutEvidence(attempt.directory, attempt.prepared)
  }
  validateControlProvenance(preparedAttempts.map(({ prepared }) => prepared))
  validateExecutionControls(preparedAttempts)
  return preparedAttempts
}

function validateHeldOutEvidence(
  attemptDirectory: string,
  prepared: PreparedAttempt,
): void {
  const attemptId = prepared.assignment.attemptId
  const state = loadState(attemptDirectory)
  if (state.attemptId !== attemptId) {
    throw new Error(
      `Attempt ${attemptId} state identity does not match its provenance`,
    )
  }
  const heldOut = state.suites['held-out']
  if (!heldOut) {
    throw new Error(`Attempt ${attemptId} is missing held-out verifier results`)
  }
  const harnessFailure =
    heldOut.harnessFailure ??
    heldOut.phaseRuns.find((phase) => phase.harnessFailure)?.harnessFailure
  if (harnessFailure) {
    throw new Error(
      `Attempt ${attemptId} has a held-out harness failure: ${harnessFailure}`,
    )
  }
  if (!heldOut.verifierGates) {
    throw new Error(`Attempt ${attemptId} is missing held-out verifier gates`)
  }

  const expectedPhases = ['bootstrap', 'checkpoint', 'final'] as const
  for (const phase of expectedPhases) {
    const matchingRuns = heldOut.phaseRuns.filter(
      (run) => run.snapshot.kind === phase,
    )
    if (
      matchingRuns.length !== 1 ||
      !matchingRuns[0]?.commandPassed ||
      !matchingRuns[0].verifierResult
    ) {
      throw new Error(
        `Attempt ${attemptId} is missing the ${phase} held-out verifier result`,
      )
    }
    const verifierResult = matchingRuns[0].verifierResult
    const expectedResultPath = `verifier-results/held-out/${phase}.json`
    if (verifierResult.path !== expectedResultPath) {
      throw new Error(
        `Attempt ${attemptId} is missing held-out verifier result file ${expectedResultPath}`,
      )
    }
    const resultPath = resolveBelow(attemptDirectory, verifierResult.path)
    if (!existsSync(resultPath)) {
      throw new Error(
        `Attempt ${attemptId} is missing held-out verifier result file ${verifierResult.path}`,
      )
    }
    if (sha256(readFileSync(resultPath)) !== verifierResult.sha256) {
      throw new Error(
        `Attempt ${attemptId} held-out verifier result digest does not match ${verifierResult.path}`,
      )
    }
    if (
      verifierResult.binding.attemptId !== attemptId ||
      verifierResult.binding.configSha256 !== prepared.configSha256 ||
      verifierResult.binding.snapshotKind !== phase ||
      verifierResult.binding.snapshotManifestSha256 !==
        matchingRuns[0].snapshot.manifestSha256 ||
      verifierResult.binding.verificationPlanSha256 !==
        prepared.provenance.artifacts.find(
          (artifact) => artifact.kind === 'verificationPlan',
        )?.sha256
    ) {
      throw new Error(
        `Attempt ${attemptId} ${phase} held-out verifier binding drifted from frozen evidence`,
      )
    }
  }
  if (heldOut.phaseRuns.length !== expectedPhases.length) {
    throw new Error(
      `Attempt ${attemptId} has unexpected held-out verifier phases`,
    )
  }
}

function validateControlProvenance(
  preparedAttempts: readonly PreparedAttempt[],
): void {
  const sorted = [...preparedAttempts].sort((left, right) =>
    left.assignment.attemptId.localeCompare(right.assignment.attemptId),
  )
  const baseline = sorted[0]
  if (!baseline) return
  const baselineSharedArtifacts = sharedArtifacts(baseline)

  for (const prepared of sorted.slice(1)) {
    const attemptId = prepared.assignment.attemptId
    if (
      prepared.provenance.specterCommit !== baseline.provenance.specterCommit
    ) {
      throw new Error(`Attempt ${attemptId} has Specter commit control drift`)
    }
    if (
      stableJson(prepared.provenance.runtime) !==
      stableJson(baseline.provenance.runtime)
    ) {
      throw new Error(`Attempt ${attemptId} has runtime control drift`)
    }
    if (
      stableJson(prepared.provenance.packages) !==
      stableJson(baseline.provenance.packages)
    ) {
      throw new Error(`Attempt ${attemptId} has package control drift`)
    }
    if (
      stableJson(sharedArtifacts(prepared)) !==
      stableJson(baselineSharedArtifacts)
    ) {
      throw new Error(`Attempt ${attemptId} has shared artifact control drift`)
    }
  }

  const domains = new Map<string, PreparedAttempt[]>()
  for (const prepared of sorted) {
    const attempts = domains.get(prepared.assignment.domainId) ?? []
    attempts.push(prepared)
    domains.set(prepared.assignment.domainId, attempts)
  }
  for (const [domainId, attempts] of domains) {
    const first = attempts[0]
    if (!first) continue
    for (const repeated of attempts.slice(1)) {
      if (
        stableJson(repeated.provenance.artifacts) !==
        stableJson(first.provenance.artifacts)
      ) {
        throw new Error(
          `Attempt ${repeated.assignment.attemptId} has domain artifact drift for ${domainId}`,
        )
      }
    }
  }
}

function validateExecutionControls(
  attempts: readonly { directory: string; prepared: PreparedAttempt }[],
): void {
  const runtime = attempts[0]?.prepared.provenance.runtime
  if (!runtime) return
  const ids = attempts
    .map(({ prepared }) => prepared.assignment.attemptId)
    .sort()
  if (stableJson([...runtime.runOrder].sort()) !== stableJson(ids)) {
    throw new Error('Frozen run order does not match the complete matrix')
  }
  for (const [blockIndex, block] of [
    runtime.runOrder.slice(0, 5),
    runtime.runOrder.slice(5),
  ].entries()) {
    const domains = new Set<string>()
    for (const attemptId of block) {
      const assignment = attempts.find(
        ({ prepared }) => prepared.assignment.attemptId === attemptId,
      )?.prepared.assignment
      if (
        !assignment ||
        assignment.attemptNumber !== blockIndex + 1 ||
        domains.has(assignment.domainId)
      ) {
        throw new Error(
          'Frozen run order must be two blocks with one attempt per domain and attempt 1 before attempt 2',
        )
      }
      domains.add(assignment.domainId)
    }
  }
  if (
    stableJson(runtime.freshContexts.map((item) => item.attemptId).sort()) !==
      stableJson(ids) ||
    new Set(runtime.freshContexts.map((item) => item.taskId)).size !== 10
  ) {
    throw new Error('Fresh-context controls do not cover every matrix attempt')
  }
  const actualOrder = attempts
    .map(({ directory, prepared }) => {
      const startedAt = loadState(directory).timer.sessions[0]?.startedAt
      if (!startedAt) {
        throw new Error(
          `Attempt ${prepared.assignment.attemptId} has no recorded active-time start`,
        )
      }
      return { id: prepared.assignment.attemptId, startedAt }
    })
    .sort(
      (left, right) =>
        Date.parse(left.startedAt) - Date.parse(right.startedAt) ||
        left.id.localeCompare(right.id),
    )
    .map(({ id }) => id)
  if (stableJson(actualOrder) !== stableJson(runtime.runOrder)) {
    throw new Error(
      'Recorded execution did not follow the frozen two-block order',
    )
  }
}

function sharedArtifacts(
  prepared: PreparedAttempt,
): readonly FrozenArtifactProvenance[] {
  return prepared.provenance.artifacts.filter(
    (artifact) => !domainSpecificArtifactKinds.has(artifact.kind),
  )
}

function gateOutcome(passed: boolean): GateOutcome {
  return passed ? 'passed' : 'failed'
}

function findMarker(
  markers: readonly AttemptMarker[],
  kind: AttemptMarker['kind'],
): AttemptMarker | undefined {
  return markers.find((entry) => entry.kind === kind)
}

function group(attempts: readonly AttemptReport[]): AggregateGroup {
  return {
    attempts: attempts.length,
    fullFirstAttemptSuccesses: attempts.filter(
      (attempt) => attempt.fullFirstAttemptSuccess,
    ).length,
    bootstrapPassed: countGate(attempts, 'bootstrap'),
    verticalPathPassed: countGate(attempts, 'verticalPath'),
    domainCompletenessPassed: countGate(attempts, 'domainCompleteness'),
    robustnessPassed: countGate(attempts, 'robustness'),
  }
}

function countGate(
  attempts: readonly AttemptReport[],
  gate: keyof AttemptReport['gates'],
): number {
  return attempts.filter((attempt) => attempt.gates[gate] === 'passed').length
}
