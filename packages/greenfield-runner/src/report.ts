import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { writeJsonAtomic } from './storage.js'
import {
  activeElapsedMs,
  loadPrepared,
  loadState,
  type Clock,
} from './runner.js'
import type {
  AggregateGroup,
  AggregateReport,
  AttemptMarker,
  AttemptReport,
  GateOutcome,
} from './types.js'

const systemClock: Clock = { now: () => new Date() }

export function buildAttemptReport(
  attemptDirectory: string,
  clock: Clock = systemClock,
): AttemptReport {
  const prepared = loadPrepared(attemptDirectory)
  const state = loadState(attemptDirectory)
  const elapsed = activeElapsedMs(state, clock)
  const verified = state.suites['held-out']?.verifierGates
  const bootstrap = verified ? gateOutcome(verified.bootstrap) : 'not-reached'
  const verticalPath = verified
    ? gateOutcome(verified.verticalPath)
    : 'not-reached'
  const domainCompleteness = verified
    ? gateOutcome(verified.domainCompleteness)
    : 'not-reached'
  const robustness = verified ? gateOutcome(verified.robustness) : 'not-reached'
  const gates = {
    bootstrap,
    verticalPath,
    domainCompleteness,
    robustness,
  }
  const bootstrapMarker = findMarker(state.markers, 'bootstrap')
  const checkpointMarker = findMarker(state.markers, 'checkpoint')
  const finalMarker = findMarker(state.markers, 'final-freeze')
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
  clock: Clock = systemClock,
): AggregateReport {
  const attempts = attemptDirectories
    .map((directory) => buildAttemptReport(directory, clock))
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
  clock: Clock = systemClock,
): AggregateReport {
  const root = resolve(attemptsRoot)
  const report = buildAggregateReport(discoverAttemptDirectories(root), clock)
  writeJsonAtomic(join(root, 'aggregate-report.json'), report)
  return report
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
