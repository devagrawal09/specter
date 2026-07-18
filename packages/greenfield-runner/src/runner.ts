import { randomUUID } from 'node:crypto'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { ProcessCommandRunner } from './command-runner.js'
import {
  appendJsonLine,
  readJson,
  resolveBelow,
  sha256,
  stableJson,
  writeJsonAtomic,
} from './storage.js'
import {
  ACTIVE_LIMIT_MS,
  type ActiveLimitWatchdog,
  type AttemptMarker,
  type AttemptState,
  type CommandExecutionResult,
  type CommandRunner,
  type EvaluationCommand,
  type MarkerKind,
  type MarkerOutcome,
  type PhaseSuiteRun,
  type PreparedAttempt,
  type RecordedCommandResult,
  type SnapshotKind,
  type SnapshotRecord,
  type SuiteKind,
  type SuiteRun,
  type VerifierBinding,
  type VerifierResultRecord,
} from './types.js'
import { validateMatrixEntry, validateProvenance } from './validation.js'

export interface Clock {
  now(): Date
}

export interface WatchdogScheduler {
  set(callback: () => void, delayMs: number): unknown
  clear(handle: unknown): void
}

const systemClock: Clock = { now: () => new Date() }
const systemWatchdogScheduler: WatchdogScheduler = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
}

export interface PrepareAttemptOptions {
  readonly attemptsRoot: string
  readonly assignment: unknown
  readonly provenance: unknown
  readonly clock?: Clock
}

export function prepareAttempt(options: PrepareAttemptOptions): string {
  const assignment = validateMatrixEntry(options.assignment)
  const provenance = validateProvenance(options.provenance)
  const attemptsRoot = resolve(options.attemptsRoot)
  mkdirSync(attemptsRoot, { recursive: true })
  const attemptDirectory = resolveBelow(attemptsRoot, assignment.attemptId)
  if (existsSync(attemptDirectory)) {
    throw new Error(
      `Refusing to overwrite existing attempt: ${attemptDirectory}`,
    )
  }

  const clock = options.clock ?? systemClock
  const preparedAt = clock.now().toISOString()
  const configSha256 = sha256(stableJson({ assignment, provenance }))
  const prepared: PreparedAttempt = {
    schemaVersion: 1,
    assignment,
    provenance,
    configSha256,
    preparedAt,
  }
  const state: AttemptState = {
    schemaVersion: 1,
    attemptId: assignment.attemptId,
    preparedAt,
    timer: {
      limitMs: ACTIVE_LIMIT_MS,
      accumulatedMs: 0,
      sessions: [],
    },
    markers: [],
    snapshots: {},
    suites: {},
  }

  mkdirSync(attemptDirectory)
  mkdirSync(join(attemptDirectory, 'logs'))
  mkdirSync(resolveBelow(attemptDirectory, assignment.workspacePath), {
    recursive: true,
  })
  writeFileSync(
    join(attemptDirectory, 'frozen-provenance.json'),
    `${stableJson(prepared)}\n`,
    { flag: 'wx' },
  )
  writeJsonAtomic(join(attemptDirectory, 'state.json'), state)
  appendChronology(attemptDirectory, clock, 'attempt-prepared', {
    configSha256,
  })
  return attemptDirectory
}

export function startActiveTime(
  attemptDirectory: string,
  clock: Clock = systemClock,
): AttemptState {
  const state = loadState(attemptDirectory)
  assertNotFrozen(state)
  if (state.timer.runningSince) {
    throw new Error('Active timer is already running')
  }
  if (state.timer.accumulatedMs >= state.timer.limitMs) {
    throw new Error('The 180 active-minute limit is already exhausted')
  }
  const now = clock.now().toISOString()
  const updated: AttemptState = {
    ...state,
    timer: { ...state.timer, runningSince: now },
  }
  saveState(attemptDirectory, updated)
  appendChronology(attemptDirectory, clock, 'active-time-started', {})
  return updated
}

export function stopActiveTime(
  attemptDirectory: string,
  clock: Clock = systemClock,
): AttemptState {
  const state = loadState(attemptDirectory)
  if (!state.timer.runningSince) throw new Error('Active timer is not running')
  const stoppedAt = clock.now()
  const elapsedMs = Math.max(
    0,
    stoppedAt.getTime() - Date.parse(state.timer.runningSince),
  )
  const accumulatedMs = state.timer.accumulatedMs + elapsedMs
  const updated: AttemptState = {
    ...state,
    timer: {
      ...state.timer,
      accumulatedMs,
      runningSince: undefined,
      sessions: [
        ...state.timer.sessions,
        {
          startedAt: state.timer.runningSince,
          stoppedAt: stoppedAt.toISOString(),
          elapsedMs,
        },
      ],
    },
  }
  saveState(attemptDirectory, updated)
  appendChronology(attemptDirectory, clock, 'active-time-stopped', {
    activeElapsedMs: accumulatedMs,
    limitExceeded: accumulatedMs > state.timer.limitMs,
  })
  return updated
}

export function activeElapsedMs(
  state: AttemptState,
  clock: Clock = systemClock,
): number {
  if (!state.timer.runningSince) return state.timer.accumulatedMs
  return (
    state.timer.accumulatedMs +
    Math.max(0, clock.now().getTime() - Date.parse(state.timer.runningSince))
  )
}

export function enforceActiveLimit(
  attemptDirectory: string,
  onLimit: () => void | Promise<void>,
  options: {
    readonly clock?: Clock
    readonly scheduler?: WatchdogScheduler
  } = {},
): ActiveLimitWatchdog {
  const clock = options.clock ?? systemClock
  const scheduler = options.scheduler ?? systemWatchdogScheduler
  const initialState = loadState(attemptDirectory)
  if (!initialState.timer.runningSince) {
    throw new Error('Active timer must be running before enforcing its limit')
  }
  const remainingMs = Math.max(
    0,
    initialState.timer.limitMs - activeElapsedMs(initialState, clock),
  )
  let handle: unknown
  let settled = false
  let resolveExpired: (expired: boolean) => void = () => undefined
  let rejectExpired: (cause: unknown) => void = () => undefined
  const expired = new Promise<boolean>((resolvePromise, rejectPromise) => {
    resolveExpired = resolvePromise
    rejectExpired = rejectPromise
  })

  const schedule = (delayMs: number): void => {
    handle = scheduler.set(() => {
      void checkLimit()
    }, delayMs)
  }
  const checkLimit = async (): Promise<void> => {
    if (settled) return
    const state = loadState(attemptDirectory)
    if (!state.timer.runningSince || state.freeze) {
      settled = true
      resolveExpired(false)
      return
    }
    const remaining = state.timer.limitMs - activeElapsedMs(state, clock)
    if (remaining > 0) {
      schedule(remaining)
      return
    }
    settled = true
    appendChronology(attemptDirectory, clock, 'active-limit-reached', {
      activeElapsedMs: activeElapsedMs(state, clock),
      limitMs: state.timer.limitMs,
    })
    try {
      await onLimit()
      resolveExpired(true)
    } catch (cause) {
      rejectExpired(cause)
    }
  }
  schedule(remainingMs)

  return {
    remainingMs,
    expired,
    cancel: () => {
      if (settled) return
      settled = true
      scheduler.clear(handle)
      resolveExpired(false)
    },
  }
}

export function recordMarker(
  attemptDirectory: string,
  kind: Exclude<MarkerKind, 'final-freeze'>,
  outcome: MarkerOutcome,
  note?: string,
  clock: Clock = systemClock,
): AttemptState {
  const state = loadState(attemptDirectory)
  assertNotFrozen(state)
  if (!state.timer.runningSince) {
    throw new Error('Markers must be recorded while active time is running')
  }
  if (state.markers.some((marker) => marker.kind === kind)) {
    throw new Error(`${kind} marker has already been recorded`)
  }
  if (
    kind === 'checkpoint' &&
    !state.markers.some((marker) => marker.kind === 'bootstrap')
  ) {
    throw new Error('Bootstrap must be recorded before checkpoint')
  }
  const elapsed = activeElapsedMs(state, clock)
  const marker: AttemptMarker = {
    kind,
    outcome: elapsed > state.timer.limitMs ? 'time-expired' : outcome,
    recordedAt: clock.now().toISOString(),
    activeElapsedMs: elapsed,
    ...(note ? { note } : {}),
  }
  const snapshotKind: SnapshotKind =
    kind === 'bootstrap' ? 'bootstrap' : 'checkpoint'
  const prepared = loadPrepared(attemptDirectory)
  const snapshot = captureSnapshot(
    attemptDirectory,
    prepared.assignment.freezePaths,
    snapshotKind,
    clock,
  )
  const updated: AttemptState = {
    ...state,
    markers: [...state.markers, marker],
    snapshots: { ...state.snapshots, [snapshotKind]: snapshot },
  }
  saveState(attemptDirectory, updated)
  appendChronology(attemptDirectory, clock, 'marker-recorded', marker)
  return updated
}

export function freezeFirstAttempt(
  attemptDirectory: string,
  outcome: MarkerOutcome,
  note?: string,
  clock: Clock = systemClock,
): AttemptState {
  let state = loadState(attemptDirectory)
  if (state.freeze) {
    throw new Error('First-attempt artifacts are already frozen')
  }
  if (state.timer.runningSince) {
    state = stopActiveTime(attemptDirectory, clock)
  }

  const prepared = loadPrepared(attemptDirectory)
  const sourcePaths = prepared.assignment.freezePaths
  const snapshot = captureSnapshot(
    attemptDirectory,
    sourcePaths,
    'final',
    clock,
  )
  const manifestSha256 = snapshot.manifestSha256

  const frozenAt = clock.now().toISOString()
  const elapsed = activeElapsedMs(state, clock)
  const marker: AttemptMarker = {
    kind: 'final-freeze',
    outcome: elapsed > state.timer.limitMs ? 'time-expired' : outcome,
    recordedAt: frozenAt,
    activeElapsedMs: elapsed,
    ...(note ? { note } : {}),
  }
  const updated: AttemptState = {
    ...state,
    markers: [...state.markers, marker],
    snapshots: { ...state.snapshots, final: snapshot },
    freeze: { frozenAt, sourcePaths, manifestSha256 },
  }
  saveState(attemptDirectory, updated)
  appendChronology(attemptDirectory, clock, 'first-attempt-frozen', {
    ...marker,
    manifestSha256,
  })
  return updated
}

export async function runVerificationSuite(
  attemptDirectory: string,
  kind: SuiteKind,
  runner: CommandRunner = new ProcessCommandRunner(),
  clock: Clock = systemClock,
): Promise<SuiteRun> {
  const state = loadState(attemptDirectory)
  if (!state.freeze) {
    throw new Error('Freeze the first attempt before verification')
  }
  if (state.suites[kind]) throw new Error(`${kind} suite has already been run`)
  if (kind === 'held-out' && !state.suites.visible) {
    throw new Error('Run visible verification before held-out verification')
  }
  if (state.remediation) {
    throw new Error('Verification cannot begin after remediation')
  }

  const prepared = loadPrepared(attemptDirectory)
  const commands =
    kind === 'visible'
      ? prepared.assignment.visibleCommands
      : prepared.assignment.heldOutCommands
  verifyAllSnapshotIntegrity(attemptDirectory, state)
  const logDirectory = join(attemptDirectory, 'logs', 'commands')
  mkdirSync(logDirectory, { recursive: true })
  const startedAt = clock.now().toISOString()
  const snapshots = snapshotsForSuite(state, kind)
  const phaseRuns: PhaseSuiteRun[] = []

  for (const snapshot of snapshots) {
    const frozenRoot = prepareVerificationWorkspace(
      attemptDirectory,
      kind,
      snapshot,
    )
    const resultPath = join(
      frozenRoot,
      prepared.assignment.workspacePath,
      'specter-evaluation',
      'verifier-result.json',
    )
    if (kind === 'held-out' && existsSync(resultPath)) {
      throw new Error(
        `Frozen ${snapshot.kind} snapshot contains a stale verifier result`,
      )
    }
    const results: RecordedCommandResult[] = []
    for (const [index, configuredCommand] of commands.entries()) {
      const command =
        kind === 'held-out'
          ? commandWithBinding(configuredCommand, prepared, snapshot)
          : configuredCommand
      const cwd = resolveBelow(frozenRoot, command.cwd)
      if (!existsSync(cwd) || !lstatSync(cwd).isDirectory()) {
        throw new Error(`Command cwd is not a frozen directory: ${command.cwd}`)
      }
      const commandStartedAt = clock.now().toISOString()
      appendChronology(attemptDirectory, clock, 'command-started', {
        suite: kind,
        snapshot: snapshot.kind,
        id: command.id,
        file: command.file,
        args: command.args,
        cwd: command.cwd,
      })
      const realStartedAt = Date.now()
      let result: CommandExecutionResult
      try {
        result = await runner.run({
          command,
          cwd,
          timeoutMs: command.timeoutMs,
        })
      } catch (cause) {
        result = {
          exitCode: null,
          signal: null,
          stdout: '',
          stderr: cause instanceof Error ? cause.message : String(cause),
          timedOut: false,
          durationMs: Date.now() - realStartedAt,
        }
      }
      const commandFinishedAt = clock.now().toISOString()
      const baseName = `${kind}-${snapshot.kind}-${String(index + 1).padStart(
        2,
        '0',
      )}-${command.id}`
      const stdoutLog = join('logs', 'commands', `${baseName}.stdout.log`)
      const stderrLog = join('logs', 'commands', `${baseName}.stderr.log`)
      writeFileSync(join(attemptDirectory, stdoutLog), result.stdout, {
        flag: 'wx',
      })
      writeFileSync(join(attemptDirectory, stderrLog), result.stderr, {
        flag: 'wx',
      })
      const recorded: RecordedCommandResult = {
        id: command.id,
        file: command.file,
        args: command.args,
        cwd: command.cwd,
        startedAt: commandStartedAt,
        finishedAt: commandFinishedAt,
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
        stdoutLog,
        stderrLog,
        passed: result.exitCode === 0 && !result.timedOut,
      }
      results.push(recorded)
      appendChronology(attemptDirectory, clock, 'command-finished', {
        suite: kind,
        snapshot: snapshot.kind,
        ...recorded,
      })
    }

    const commandPassed = commandsCompleted(results, kind)
    let verifierResult: VerifierResultRecord | undefined
    let harnessFailure: string | undefined
    if (kind === 'held-out') {
      if (!commandPassed) {
        harnessFailure =
          'held-out command failed before producing a valid verifier result'
      } else {
        try {
          verifierResult = readAndPreserveVerifierResult(
            attemptDirectory,
            resultPath,
            prepared,
            snapshot,
          )
          const verifierExitCode = results.at(-1)?.exitCode
          if (
            (verifierExitCode === 0 &&
              !verifierResult.fullFirstAttemptSuccess) ||
            (verifierExitCode === 1 && verifierResult.fullFirstAttemptSuccess)
          ) {
            throw new Error(
              `Verifier exit ${verifierExitCode} disagrees with fullFirstAttemptSuccess`,
            )
          }
        } catch (cause) {
          harnessFailure =
            cause instanceof Error ? cause.message : String(cause)
        }
      }
    }
    phaseRuns.push({
      snapshot,
      verificationArtifacts: relative(attemptDirectory, frozenRoot),
      commands: results,
      commandPassed,
      ...(harnessFailure ? { harnessFailure } : {}),
      ...(verifierResult ? { verifierResult } : {}),
    })
  }

  const results = phaseRuns.flatMap((phase) => phase.commands)
  const verifierGates =
    kind === 'held-out' ? phaseSpecificGates(phaseRuns) : undefined
  const harnessFailure = phaseRuns.find(
    (phase) => phase.harnessFailure,
  )?.harnessFailure
  const suite: SuiteRun = {
    kind,
    startedAt,
    finishedAt: clock.now().toISOString(),
    passed:
      kind === 'visible'
        ? phaseRuns.every((phase) => phase.commandPassed)
        : !harnessFailure &&
          verifierGates !== undefined &&
          Object.values(verifierGates).every(Boolean),
    verificationArtifacts: phaseRuns.at(-1)?.verificationArtifacts ?? '',
    commands: results,
    phaseRuns,
    ...(harnessFailure ? { harnessFailure } : {}),
    ...(verifierGates ? { verifierGates } : {}),
  }
  verifyAllSnapshotIntegrity(attemptDirectory, state)
  const latestState = loadState(attemptDirectory)
  const updated: AttemptState = {
    ...latestState,
    suites: { ...latestState.suites, [kind]: suite },
  }
  saveState(attemptDirectory, updated)
  writeJsonAtomic(join(attemptDirectory, `${kind}-results.json`), suite)
  appendChronology(attemptDirectory, clock, 'suite-finished', {
    kind,
    passed: suite.passed,
  })
  return suite
}

export function beginRemediation(
  attemptDirectory: string,
  clock: Clock = systemClock,
): AttemptState {
  const state = loadState(attemptDirectory)
  if (!state.freeze || !state.suites.visible || !state.suites['held-out']) {
    throw new Error(
      'Freeze and run both verification suites before remediation',
    )
  }
  if (state.remediation) {
    throw new Error('Remediation has already started')
  }
  const startedAt = clock.now().toISOString()
  const updated = { ...state, remediation: { startedAt } }
  saveState(attemptDirectory, updated)
  appendChronology(attemptDirectory, clock, 'remediation-started', {})
  return updated
}

export function freezeRemediation(
  attemptDirectory: string,
  clock: Clock = systemClock,
): AttemptState {
  const state = loadState(attemptDirectory)
  if (!state.remediation) throw new Error('Remediation has not started')
  if (state.remediation.finishedAt) {
    throw new Error('Remediation has already finished')
  }
  if (state.remediation.snapshot) {
    throw new Error('Remediation artifacts are already frozen')
  }
  const prepared = loadPrepared(attemptDirectory)
  const snapshot = captureSnapshot(
    attemptDirectory,
    prepared.assignment.freezePaths,
    'remediation',
    clock,
  )
  const updated: AttemptState = {
    ...state,
    snapshots: { ...state.snapshots, remediation: snapshot },
    remediation: { ...state.remediation, snapshot },
  }
  saveState(attemptDirectory, updated)
  appendChronology(attemptDirectory, clock, 'remediation-frozen', {
    manifestSha256: snapshot.manifestSha256,
  })
  return updated
}

export function finishRemediation(
  attemptDirectory: string,
  verificationResultPath: string,
  note?: string,
  clock: Clock = systemClock,
): AttemptState {
  const state = loadState(attemptDirectory)
  if (!state.remediation) throw new Error('Remediation has not started')
  if (state.remediation.finishedAt) {
    throw new Error('Remediation has already finished')
  }
  if (!state.remediation.snapshot) {
    throw new Error('Freeze remediation artifacts before recording a result')
  }
  verifySnapshotIntegrity(attemptDirectory, state.remediation.snapshot)
  const prepared = loadPrepared(attemptDirectory)
  const resultBytes = readFileSync(resolve(verificationResultPath))
  let rawResult: unknown
  try {
    rawResult = JSON.parse(resultBytes.toString('utf8')) as unknown
  } catch {
    throw new Error('Remediation verifier result is not valid JSON')
  }
  const result = object(rawResult, 'Remediation verifier result')
  if (result.schemaVersion !== 1) {
    throw new Error('Remediation verifier result has an invalid schemaVersion')
  }
  validateAttemptIdentity(result.attempt, prepared)
  const binding = validateBinding(
    result.coordinatorBinding,
    prepared,
    state.remediation.snapshot,
  )
  const remediationPhase = object(
    result.remediation,
    'Remediation verifier phase',
  )
  if (
    remediationPhase.phase !== 'remediation' ||
    typeof remediationPhase.isolationCompromised !== 'boolean' ||
    typeof remediationPhase.allMandatoryChecksPassed !== 'boolean'
  ) {
    throw new Error('Remediation verifier phase has an invalid result shape')
  }
  const remediationGates = readStrictGates(
    remediationPhase.gates,
    'remediation',
  )
  const expectedSuccess =
    !remediationPhase.isolationCompromised &&
    Object.values(remediationGates).every(Boolean)
  if (result.eventualSuccess !== expectedSuccess) {
    throw new Error(
      'Remediation eventualSuccess disagrees with its cumulative gates',
    )
  }
  const outcome: 'passed' | 'failed' = expectedSuccess ? 'passed' : 'failed'
  writeFileSync(
    join(resolve(attemptDirectory), 'remediation-results.json'),
    resultBytes,
    {
      flag: 'wx',
    },
  )
  const finishedAt = clock.now().toISOString()
  const remediation = {
    ...state.remediation,
    finishedAt,
    outcome,
    resultSha256: sha256(resultBytes),
    verifierBinding: binding,
    ...(note ? { note } : {}),
  }
  const updated = { ...state, remediation }
  saveState(attemptDirectory, updated)
  appendChronology(attemptDirectory, clock, 'remediation-finished', {
    outcome,
    ...(note ? { note } : {}),
  })
  return updated
}

const gateNames = [
  'bootstrap',
  'verticalPath',
  'domainCompleteness',
  'robustness',
] as const

function commandWithBinding(
  command: EvaluationCommand,
  prepared: PreparedAttempt,
  snapshot: SnapshotRecord,
): EvaluationCommand {
  return {
    ...command,
    env: {
      ...command.env,
      SPECTER_EVALUATION_ATTEMPT_ID: prepared.assignment.attemptId,
      SPECTER_EVALUATION_CONFIG_SHA256: prepared.configSha256,
      SPECTER_EVALUATION_SNAPSHOT_KIND: snapshot.kind,
      SPECTER_EVALUATION_SNAPSHOT_SHA256: snapshot.manifestSha256,
    },
  }
}

function commandsCompleted(
  results: readonly RecordedCommandResult[],
  kind: SuiteKind,
): boolean {
  if (results.some((result) => result.timedOut || result.exitCode === null)) {
    return false
  }
  if (kind === 'visible') {
    return results.every((result) => result.exitCode === 0)
  }
  return results.every(
    (result, index) =>
      result.exitCode === 0 ||
      (index === results.length - 1 && result.exitCode === 1),
  )
}

function phaseSpecificGates(
  runs: readonly PhaseSuiteRun[],
): Readonly<Record<(typeof gateNames)[number], boolean>> | undefined {
  const bootstrap = runs.find((run) => run.snapshot.kind === 'bootstrap')
  const checkpoint = runs.find((run) => run.snapshot.kind === 'checkpoint')
  const final = runs.find((run) => run.snapshot.kind === 'final')
  if (
    !bootstrap?.verifierResult ||
    !checkpoint?.verifierResult ||
    !final?.verifierResult
  ) {
    return undefined
  }
  return {
    bootstrap: bootstrap.verifierResult.gates.bootstrap,
    verticalPath: checkpoint.verifierResult.gates.verticalPath,
    domainCompleteness: final.verifierResult.gates.domainCompleteness,
    robustness: final.verifierResult.gates.robustness,
  }
}

function readAndPreserveVerifierResult(
  attemptDirectory: string,
  path: string,
  prepared: PreparedAttempt,
  snapshot: SnapshotRecord,
): VerifierResultRecord {
  if (!existsSync(path)) {
    throw new Error(`Held-out verifier did not write ${path}`)
  }
  const bytes = readFileSync(path)
  let value: unknown
  try {
    value = JSON.parse(bytes.toString('utf8')) as unknown
  } catch {
    throw new Error('Held-out verifier result is not valid JSON')
  }
  const result = object(value, 'Held-out verifier result')
  if (result.schemaVersion !== 1) {
    throw new Error('Held-out verifier result has an invalid schemaVersion')
  }
  validateAttemptIdentity(result.attempt, prepared)
  const binding = validateBinding(result.coordinatorBinding, prepared, snapshot)
  const firstAttempt = object(
    result.firstAttempt,
    'Held-out verifier firstAttempt',
  )
  const gates = readStrictGates(firstAttempt.gates, 'firstAttempt')
  const gatesAllPassed = Object.values(gates).every(Boolean)
  if (
    typeof result.fullFirstAttemptSuccess !== 'boolean' ||
    (result.fullFirstAttemptSuccess && !gatesAllPassed)
  ) {
    throw new Error(
      'Held-out verifier fullFirstAttemptSuccess is invalid for its cumulative gates',
    )
  }
  const resultRoot = join(attemptDirectory, 'verifier-results', 'held-out')
  mkdirSync(resultRoot, { recursive: true })
  const preservedPath = join(resultRoot, `${snapshot.kind}.json`)
  writeFileSync(preservedPath, bytes, { flag: 'wx' })
  return {
    path: relative(attemptDirectory, preservedPath),
    sha256: sha256(bytes),
    binding,
    fullFirstAttemptSuccess: result.fullFirstAttemptSuccess,
    gates,
  }
}

function validateAttemptIdentity(
  value: unknown,
  prepared: PreparedAttempt,
): void {
  const attempt = object(value, 'verifier attempt')
  const expectedTopology =
    prepared.assignment.topology === 'single-process'
      ? 'singleProcess'
      : 'multiProcess'
  const expected = {
    id: prepared.assignment.attemptId,
    domain: prepared.assignment.domainId,
    persistence: prepared.assignment.persistence,
    topology: expectedTopology,
    port: prepared.assignment.port,
    activeLimitMinutes: 180,
  }
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (attempt[key] !== expectedValue) {
      throw new Error(
        `Verifier result identity mismatch for ${key}: expected ${expectedValue}`,
      )
    }
  }
}

function validateBinding(
  value: unknown,
  prepared: PreparedAttempt,
  snapshot: SnapshotRecord,
): VerifierBinding {
  const binding = object(value, 'coordinatorBinding')
  const expected = {
    attemptId: prepared.assignment.attemptId,
    configSha256: prepared.configSha256,
    snapshotKind: snapshot.kind,
    snapshotManifestSha256: snapshot.manifestSha256,
  }
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (binding[key] !== expectedValue) {
      throw new Error(
        `Verifier result binding mismatch for ${key}: expected ${expectedValue}`,
      )
    }
  }
  if (
    typeof binding.verificationPlanSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(binding.verificationPlanSha256)
  ) {
    throw new Error(
      'Verifier result binding has an invalid verificationPlanSha256',
    )
  }
  return binding as unknown as VerifierBinding
}

function readStrictGates(
  value: unknown,
  label: string,
): Readonly<Record<(typeof gateNames)[number], boolean>> {
  if (!Array.isArray(value) || value.length !== gateNames.length) {
    throw new Error(`${label} must contain exactly four verifier gates`)
  }
  const output = {} as Record<string, boolean>
  for (const entry of value) {
    const gate = object(entry, `${label} gate`)
    if (
      !gateNames.includes(gate.gate as (typeof gateNames)[number]) ||
      typeof gate.passed !== 'boolean' ||
      output[String(gate.gate)] !== undefined
    ) {
      throw new Error(`${label} contains an invalid or duplicate gate`)
    }
    output[String(gate.gate)] = gate.passed
  }
  return output as Record<(typeof gateNames)[number], boolean>
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

export function loadState(attemptDirectory: string): AttemptState {
  return readJson(join(resolve(attemptDirectory), 'state.json')) as AttemptState
}

export function loadPrepared(attemptDirectory: string): PreparedAttempt {
  return readJson(
    join(resolve(attemptDirectory), 'frozen-provenance.json'),
  ) as PreparedAttempt
}

function saveState(attemptDirectory: string, state: AttemptState): void {
  writeJsonAtomic(join(resolve(attemptDirectory), 'state.json'), state)
}

function assertNotFrozen(state: AttemptState): void {
  if (state.freeze) throw new Error('The scored attempt is already frozen')
}

function appendChronology(
  attemptDirectory: string,
  clock: Clock,
  event: string,
  details: object,
): void {
  appendJsonLine(join(attemptDirectory, 'logs', 'chronology.jsonl'), {
    at: clock.now().toISOString(),
    event,
    details,
  })
}

function artifactManifest(root: string): readonly object[] {
  const entries: object[] = []
  visit(root)
  return entries

  function visit(directory: string): void {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name)
      const stats = lstatSync(path)
      const relativePath = relative(root, path)
      if (stats.isDirectory()) {
        entries.push({ path: relativePath, type: 'directory' })
        visit(path)
      } else if (stats.isSymbolicLink()) {
        throw new Error(
          `Symlinks are not allowed in artifacts: ${relativePath}`,
        )
      } else if (stats.isFile()) {
        entries.push({
          path: relativePath,
          type: 'file',
          size: stats.size,
          sha256: sha256(readFileSync(path)),
        })
      } else {
        throw new Error(`Unsupported artifact type: ${relativePath}`)
      }
    }
  }
}

function captureSnapshot(
  attemptDirectory: string,
  sourcePaths: readonly string[],
  kind: SnapshotKind,
  clock: Clock,
): SnapshotRecord {
  for (const sourcePath of sourcePaths) {
    const source = resolveBelow(attemptDirectory, sourcePath)
    if (!existsSync(source)) {
      throw new Error(`Cannot snapshot missing artifact path: ${sourcePath}`)
    }
    assertNoSymlinkComponents(attemptDirectory, sourcePath)
    assertArtifactTreeHasNoSymlinks(source, sourcePath)
  }
  const snapshotDirectory = snapshotDirectoryFor(attemptDirectory, kind)
  if (existsSync(snapshotDirectory)) {
    throw new Error(`Refusing to overwrite snapshot: ${snapshotDirectory}`)
  }
  const temporaryDirectory = `${snapshotDirectory}.tmp-${randomUUID()}`
  mkdirSync(join(temporaryDirectory, 'artifacts'), { recursive: true })
  for (const sourcePath of sourcePaths) {
    const source = resolveBelow(attemptDirectory, sourcePath)
    const destination = resolveBelow(
      join(temporaryDirectory, 'artifacts'),
      sourcePath,
    )
    mkdirSync(resolve(destination, '..'), { recursive: true })
    cpSync(source, destination, {
      recursive: true,
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
    })
  }
  const manifest = artifactManifest(join(temporaryDirectory, 'artifacts'))
  const manifestSha256 = sha256(stableJson(manifest))
  writeFileSync(
    join(temporaryDirectory, 'manifest.json'),
    `${stableJson({ files: manifest, manifestSha256 })}\n`,
    { flag: 'wx' },
  )
  mkdirSync(resolve(snapshotDirectory, '..'), { recursive: true })
  renameSync(temporaryDirectory, snapshotDirectory)
  return {
    kind,
    capturedAt: clock.now().toISOString(),
    sourcePaths,
    manifestSha256,
  }
}

function snapshotDirectoryFor(
  attemptDirectory: string,
  kind: SnapshotKind,
): string {
  if (kind === 'final') return join(attemptDirectory, 'first-attempt')
  if (kind === 'remediation') return join(attemptDirectory, 'remediation')
  return join(attemptDirectory, 'phase-snapshots', kind)
}

function snapshotsForSuite(
  state: AttemptState,
  kind: SuiteKind,
): SnapshotRecord[] {
  const required: SnapshotKind[] =
    kind === 'visible' ? ['final'] : ['bootstrap', 'checkpoint', 'final']
  return required.map((snapshotKind) => {
    const snapshot = state.snapshots[snapshotKind]
    if (!snapshot) {
      throw new Error(`Missing immutable ${snapshotKind} snapshot`)
    }
    return snapshot
  })
}

function prepareVerificationWorkspace(
  attemptDirectory: string,
  kind: SuiteKind,
  snapshot: SnapshotRecord,
): string {
  const verificationRoot = join(attemptDirectory, 'verification')
  if (
    existsSync(verificationRoot) &&
    lstatSync(verificationRoot).isSymbolicLink()
  ) {
    throw new Error('Symlinks are not allowed in the verification directory')
  }
  mkdirSync(verificationRoot, { recursive: true })
  const suiteDirectory = join(verificationRoot, kind, snapshot.kind)
  if (existsSync(suiteDirectory)) {
    throw new Error(
      `Refusing to overwrite verification workspace: ${suiteDirectory}`,
    )
  }
  mkdirSync(join(verificationRoot, kind), { recursive: true })
  const temporaryDirectory = join(
    verificationRoot,
    `.${kind}-${snapshot.kind}.tmp-${randomUUID()}`,
  )
  const artifactsDirectory = join(temporaryDirectory, 'artifacts')
  cpSync(
    join(snapshotDirectoryFor(attemptDirectory, snapshot.kind), 'artifacts'),
    artifactsDirectory,
    {
      recursive: true,
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
    },
  )
  assertArtifactTreeHasNoSymlinks(
    artifactsDirectory,
    `verification/${kind}/${snapshot.kind}/artifacts`,
  )
  const copiedManifestSha256 = sha256(
    stableJson(artifactManifest(artifactsDirectory)),
  )
  if (copiedManifestSha256 !== snapshot.manifestSha256) {
    throw new Error(
      `Verification artifact copy failed integrity check: expected ${snapshot.manifestSha256}, received ${copiedManifestSha256}`,
    )
  }
  renameSync(temporaryDirectory, suiteDirectory)
  return join(suiteDirectory, 'artifacts')
}

function verifyAllSnapshotIntegrity(
  attemptDirectory: string,
  state: AttemptState,
): void {
  if (!state.freeze) {
    throw new Error('First-attempt freeze metadata is missing')
  }
  for (const snapshot of Object.values(state.snapshots)) {
    if (!snapshot) continue
    verifySnapshotIntegrity(attemptDirectory, snapshot)
  }
}

function verifySnapshotIntegrity(
  attemptDirectory: string,
  snapshot: SnapshotRecord,
): void {
  const root = join(
    snapshotDirectoryFor(attemptDirectory, snapshot.kind),
    'artifacts',
  )
  assertArtifactTreeHasNoSymlinks(root, `${snapshot.kind}/artifacts`)
  const actualSha256 = sha256(stableJson(artifactManifest(root)))
  if (actualSha256 !== snapshot.manifestSha256) {
    throw new Error(
      `Frozen ${snapshot.kind} snapshot integrity check failed: expected ${snapshot.manifestSha256}, received ${actualSha256}`,
    )
  }
}

function assertNoSymlinkComponents(root: string, relativePath: string): void {
  let current = resolve(root)
  for (const component of relativePath.split(/[\\/]/)) {
    current = join(current, component)
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error(
        `Symlinks are not allowed in freezePaths: ${relativePath}`,
      )
    }
  }
}

function assertArtifactTreeHasNoSymlinks(
  path: string,
  displayPath: string,
): void {
  const stats = lstatSync(path)
  if (stats.isSymbolicLink()) {
    throw new Error(`Symlinks are not allowed in artifacts: ${displayPath}`)
  }
  if (!stats.isDirectory()) return
  for (const name of readdirSync(path).sort()) {
    assertArtifactTreeHasNoSymlinks(join(path, name), join(displayPath, name))
  }
}
