import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'

import {
  ACTIVE_LIMIT_MS,
  CHECKPOINT_LIMIT_MS,
  REMEDIATION_LIMIT_MS,
  activeElapsedMs,
  beginRemediation,
  buildAttemptReport,
  type Clock,
  type CommandExecutionRequest,
  type CommandExecutionResult,
  type CommandRunner,
  enforceActiveLimit,
  enforceRemediationLimit,
  finishRemediation,
  freezeFirstAttempt,
  freezeRemediation,
  loadPrepared,
  prepareAttempt,
  recordMarker,
  recordPassingIsolationAttestation,
  provenanceArtifactKinds,
  runVerificationSuite,
  startActiveTime as startActiveTimeWithoutAttestation,
  startRemediationTime,
  stableJson,
  stopActiveTime,
  validateMatrixEntry,
  validateProvenance,
  type WatchdogScheduler,
} from '../dist/index.js'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('greenfield evaluation runner', () => {
  it('rejects unaudited pauses and persists an allowlisted pause lifecycle', () => {
    const root = temporaryRoot()
    const clock = new TestClock('2026-07-18T00:00:00.000Z')
    const attempt = prepareAttempt({
      ...attemptRoots(root),
      assignment: assignment(),
      provenance: provenance(),
      clock,
    })
    startActiveTime(attempt, clock)
    clock.advance(1_000)
    assert.throws(
      () =>
        stopActiveTime(
          attempt,
          {
            reason: 'adopter-wait' as never,
            triggerEvidence: 'agent requested idle time',
            coordinatorAction: 'pause timer',
          },
          clock,
        ),
      /Pause reason must be allowlisted/,
    )
    assert.throws(
      () =>
        stopActiveTime(
          attempt,
          {
            reason: 'coordinator-approval',
            triggerEvidence: ' ',
            coordinatorAction: 'reviewed pre-authorization',
          },
          clock,
        ),
      /trigger evidence must be non-empty/,
    )

    const paused = stopActiveTime(
      attempt,
      {
        reason: 'coordinator-approval',
        triggerEvidence: 'approval request approval-17',
        coordinatorAction: 'reviewed pre-authorization approval-17',
      },
      clock,
    )
    assert.deepEqual(paused.timer.pauses[0], {
      reason: 'coordinator-approval',
      triggerEvidence: 'approval request approval-17',
      coordinatorAction: 'reviewed pre-authorization approval-17',
      startedAt: '2026-07-18T00:00:01.000Z',
    })
    clock.advance(5_000)
    const resumed = startActiveTimeWithoutAttestation(attempt, clock)
    assert.equal(resumed.timer.pauses[0]?.endedAt, clock.now().toISOString())
    assert.equal(resumed.timer.pauses[0]?.wallElapsedMs, 5_000)
    assert.equal(activeElapsedMs(resumed, clock), 1_000)
  })

  it('enforces a separate 60-active-minute remediation watchdog', async () => {
    const { attempt, clock } = readyAttempt()
    await runVerificationSuite(attempt, 'visible', new FakeRunner(), clock)
    await runVerificationSuite(attempt, 'held-out', new FakeRunner(), clock)
    const begun = beginRemediation(attempt, clock)
    assert.equal(begun.remediation?.timer.limitMs, REMEDIATION_LIMIT_MS)
    const scheduler = new TestScheduler()
    let terminated = false
    const watchdog = enforceRemediationLimit(
      attempt,
      () => {
        terminated = true
      },
      { clock, scheduler },
    )
    assert.equal(watchdog.remainingMs, REMEDIATION_LIMIT_MS)
    clock.advance(REMEDIATION_LIMIT_MS)
    scheduler.fire()
    assert.equal(await watchdog.expired, true)
    assert.equal(terminated, true)
    assert.throws(
      () => startRemediationTime(attempt, clock),
      /timer is already running/,
    )
  })

  it('refuses to start scored time without persisted passing isolation', () => {
    const root = temporaryRoot()
    const clock = new TestClock('2026-07-18T00:00:00.000Z')
    const attempt = prepareAttempt({
      ...attemptRoots(root),
      assignment: assignment(),
      provenance: provenance(),
      clock,
    })

    assert.throws(
      () => startActiveTimeWithoutAttestation(attempt, clock),
      /persisted passing isolation attestation is required/,
    )
  })

  it('forces the checkpoint marker and score to expire at 75 minutes', async () => {
    const root = temporaryRoot()
    const clock = new TestClock('2026-07-18T00:00:00.000Z')
    const attempt = prepareAttempt({
      ...attemptRoots(root),
      assignment: assignment(),
      provenance: provenance(),
      clock,
    })
    writeFileSync(
      join(adopterDirectory(attempt), 'workspace', 'app.txt'),
      'checkpoint candidate\n',
    )
    startActiveTime(attempt, clock)
    recordMarker(attempt, 'bootstrap', 'passed', undefined, clock)
    clock.advance(CHECKPOINT_LIMIT_MS)

    const state = recordMarker(
      attempt,
      'checkpoint',
      'passed',
      undefined,
      clock,
    )

    assert.equal(state.markers.at(-1)?.outcome, 'time-expired')
    freezeFirstAttempt(attempt, 'passed', undefined, clock)
    await runVerificationSuite(attempt, 'visible', new FakeRunner(), clock)
    await runVerificationSuite(
      attempt,
      'held-out',
      new PhaseVerifierRunner(),
      clock,
    )
    const report = buildAttemptReport(attempt, clock)
    assert.equal(report.gates.verticalPath, 'failed')
    assert.equal(report.fullFirstAttemptSuccess, false)
  })

  it('preserves a frozen attempt and runs suites in order', async () => {
    const root = temporaryRoot()
    const clock = new TestClock('2026-07-18T00:00:00.000Z')
    const attempt = prepareAttempt({
      ...attemptRoots(root),
      assignment: assignment(),
      provenance: provenance(),
      clock,
    })
    assert.throws(
      () =>
        prepareAttempt({
          ...attemptRoots(root),
          assignment: assignment(),
          provenance: provenance(),
          clock,
        }),
      /Refusing to overwrite existing attempt/,
    )

    writeFileSync(
      join(adopterDirectory(attempt), 'workspace', 'app.txt'),
      'bootstrap version\n',
    )
    clock.advance(5_000)
    startActiveTime(attempt, clock)
    clock.advance(10_000)
    recordMarker(attempt, 'bootstrap', 'passed', undefined, clock)
    writeFileSync(
      join(adopterDirectory(attempt), 'workspace', 'app.txt'),
      'checkpoint version\n',
    )
    clock.advance(20_000)
    recordMarker(attempt, 'checkpoint', 'passed', undefined, clock)
    writeFileSync(
      join(adopterDirectory(attempt), 'workspace', 'app.txt'),
      'scored version\n',
    )
    clock.advance(30_000)
    freezeFirstAttempt(attempt, 'passed', undefined, clock)

    writeFileSync(
      join(adopterDirectory(attempt), 'workspace', 'app.txt'),
      'remediated later\n',
    )
    assert.equal(
      readFileSync(
        join(attempt, 'first-attempt', 'artifacts', 'workspace', 'app.txt'),
        'utf8',
      ),
      'scored version\n',
    )
    assert.equal(
      existsSync(join(attempt, 'first-attempt', 'manifest.json')),
      true,
    )

    const runner = new MutatingFakeRunner()
    await runVerificationSuite(attempt, 'visible', runner, clock)
    await runVerificationSuite(attempt, 'held-out', runner, clock)
    const state = beginRemediation(attempt, clock)
    assert.ok(state.remediation?.startedAt)
    freezeRemediation(attempt, clock)
    clock.advance(15_000)
    const remediationResult = join(root, 'remediation-verifier-result.json')
    writeFileSync(
      remediationResult,
      JSON.stringify(
        verifierResult(
          remediationBinding(attempt),
          allGates(true),
          { remediation: true },
        ),
      ),
    )
    finishRemediation(attempt, remediationResult, undefined, clock)

    const report = buildAttemptReport(attempt, clock)
    assert.equal(report.activeElapsedMs, 60_000)
    assert.deepEqual(report.timing, {
      setupWallMs: 5_000,
      bootstrapActiveMs: 10_000,
      verticalPathActiveMs: 20_000,
      fullAppActiveMs: 30_000,
      totalActiveMs: 60_000,
      scoredWallMs: 60_000,
    })
    assert.deepEqual(report.gates, {
      bootstrap: 'passed',
      verticalPath: 'passed',
      domainCompleteness: 'passed',
      robustness: 'passed',
    })
    assert.equal(report.fullFirstAttemptSuccess, true)
    assert.deepEqual(report.remediation, {
      started: true,
      finished: true,
      eventualSuccess: true,
      extraWallMs: 15_000,
    })
    assert.deepEqual(
      runner.requests.map((request) => request.command.id),
      [
        'visible-check',
        'robustness-check',
        'robustness-check',
        'robustness-check',
      ],
    )
    assert.ok(
      runner.requests[0]?.cwd.endsWith(
        'verification/visible/final/artifacts/workspace',
      ),
    )
    assert.ok(
      runner.requests[1]?.cwd.endsWith(
        'verification/held-out/bootstrap/artifacts/workspace',
      ),
    )
    assert.deepEqual(runner.observedContents, [
      'scored version\n',
      'bootstrap version\n',
      'checkpoint version\n',
      'scored version\n',
    ])
    assert.equal(
      readFileSync(
        join(attempt, 'first-attempt', 'artifacts', 'workspace', 'app.txt'),
        'utf8',
      ),
      'scored version\n',
    )

    const chronology = readFileSync(
      join(attempt, 'logs', 'chronology.jsonl'),
      'utf8',
    )
      .trim()
      .split('\n')
    assert.ok(chronology.length >= 10)
    assert.doesNotThrow(() => chronology.forEach((line) => JSON.parse(line)))
  })

  it('marks work beyond 180 active minutes as expired', () => {
    const root = temporaryRoot()
    const clock = new TestClock('2026-07-18T00:00:00.000Z')
    const attempt = prepareAttempt({
      ...attemptRoots(root),
      assignment: assignment(),
      provenance: provenance(),
      clock,
    })
    startActiveTime(attempt, clock)
    clock.advance(ACTIVE_LIMIT_MS + 1)
    const state = recordMarker(
      attempt,
      'bootstrap',
      'passed',
      undefined,
      clock,
    )
    assert.equal(state.markers[0]?.outcome, 'time-expired')
    const frozen = freezeFirstAttempt(attempt, 'passed', undefined, clock)
    assert.equal(frozen.markers.at(-1)?.outcome, 'time-expired')
    assert.equal(buildAttemptReport(attempt, clock).activeLimitExceeded, true)
  })

  it('enforces the active limit with a coordinator termination callback', async () => {
    const root = temporaryRoot()
    const clock = new TestClock('2026-07-18T00:00:00.000Z')
    const attempt = prepareAttempt({
      ...attemptRoots(root),
      assignment: assignment(),
      provenance: provenance(),
      clock,
    })
    startActiveTime(attempt, clock)
    const scheduler = new TestScheduler()
    let terminated = false
    const watchdog = enforceActiveLimit(
      attempt,
      () => {
        terminated = true
      },
      { clock, scheduler },
    )
    assert.equal(watchdog.remainingMs, ACTIVE_LIMIT_MS)
    assert.equal(scheduler.delayMs, ACTIVE_LIMIT_MS)
    clock.advance(ACTIVE_LIMIT_MS)
    scheduler.fire()
    assert.equal(await watchdog.expired, true)
    assert.equal(terminated, true)
  })

  it('validates cross-field assignment rules and command safety', () => {
    assert.throws(
      () =>
        validateMatrixEntry({
          ...assignment(),
          topology: 'multi-process',
        }),
      /SQLite entries must be single-process/,
    )
    assert.throws(
      () =>
        validateMatrixEntry({
          ...assignment(),
          visibleCommands: [
            {
              id: 'unsafe',
              file: 'sh',
              args: ['-c', 'echo unsafe'],
              cwd: 'workspace',
              timeoutMs: 1000,
            },
          ],
        }),
      /must not invoke a command shell/,
    )
    assert.throws(
      () =>
        validateMatrixEntry({ ...assignment(), freezePaths: ['../escape'] }),
      /safe relative path|stay below/,
    )
    assert.throws(
      () => validateMatrixEntry({ ...assignment(), freezePaths: ['logs'] }),
      /workspacePath must be included in freezePaths/,
    )
    assert.throws(
      () =>
        validateProvenance({
          ...provenance(),
          artifactManifestSha256: undefined,
        }),
      /artifactManifestSha256 must be a string/,
    )
  })

  it('rejects symlinks anywhere in a frozen artifact tree', () => {
    const root = temporaryRoot()
    const outside = temporaryRoot()
    const clock = new TestClock('2026-07-18T00:00:00.000Z')
    const attempt = prepareAttempt({
      ...attemptRoots(root),
      assignment: assignment(),
      provenance: provenance(),
      clock,
    })
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'outside.txt'), 'outside\n')
    mkdirSync(join(adopterDirectory(attempt), 'workspace', 'nested'))
    symlinkSync(
      join(outside, 'outside.txt'),
      join(adopterDirectory(attempt), 'workspace', 'nested', 'escape.txt'),
    )
    startActiveTime(attempt, clock)
    assert.throws(
      () => freezeFirstAttempt(attempt, 'failed', undefined, clock),
      /Symlinks are not allowed in artifacts/,
    )
    assert.equal(existsSync(join(attempt, 'first-attempt')), false)

    const secondRoot = temporaryRoot()
    const secondAttempt = prepareAttempt({
      ...attemptRoots(secondRoot),
      assignment: {
        ...assignment(),
        workspacePath: 'linked-workspace',
        freezePaths: ['linked-workspace'],
      },
      provenance: provenance(),
      clock,
    })
    mkdirSync(join(adopterDirectory(secondAttempt), 'real-workspace'))
    rmSync(join(adopterDirectory(secondAttempt), 'linked-workspace'), {
      recursive: true,
    })
    symlinkSync(
      join(adopterDirectory(secondAttempt), 'real-workspace'),
      join(adopterDirectory(secondAttempt), 'linked-workspace'),
      'dir',
    )
    startActiveTime(secondAttempt, clock)
    assert.throws(
      () => freezeFirstAttempt(secondAttempt, 'failed', undefined, clock),
      /Symlinks are not allowed in freezePaths/,
    )
  })

  it('refuses to overwrite a pre-existing suite workspace', async () => {
    const root = temporaryRoot()
    const clock = new TestClock('2026-07-18T00:00:00.000Z')
    const attempt = prepareAttempt({
      ...attemptRoots(root),
      assignment: assignment(),
      provenance: provenance(),
      clock,
    })
    writeFileSync(
      join(adopterDirectory(attempt), 'workspace', 'app.txt'),
      'scored version\n',
    )
    startActiveTime(attempt, clock)
    freezeFirstAttempt(attempt, 'failed', undefined, clock)
    mkdirSync(join(attempt, 'verification', 'visible', 'final'), {
      recursive: true,
    })
    await assert.rejects(
      runVerificationSuite(attempt, 'visible', new FakeRunner(), clock),
      /Refusing to overwrite verification workspace/,
    )
  })

  it('revalidates the persisted isolation attestation before verification', async () => {
    const { attempt, clock } = readyAttempt()
    rmSync(join(attempt, 'isolation-attestation.json'))

    await assert.rejects(
      runVerificationSuite(attempt, 'visible', new FakeRunner(), clock),
      /persisted passing isolation attestation is required/,
    )
  })

  it('detects any mutation of the original freeze after a suite', async () => {
    const root = temporaryRoot()
    const clock = new TestClock('2026-07-18T00:00:00.000Z')
    const attempt = prepareAttempt({
      ...attemptRoots(root),
      assignment: assignment(),
      provenance: provenance(),
      clock,
    })
    writeFileSync(
      join(adopterDirectory(attempt), 'workspace', 'app.txt'),
      'scored version\n',
    )
    startActiveTime(attempt, clock)
    freezeFirstAttempt(attempt, 'failed', undefined, clock)
    const runner = new FrozenMutationRunner(attempt)
    await assert.rejects(
      runVerificationSuite(attempt, 'visible', runner, clock),
      /Frozen final snapshot integrity check failed/,
    )
  })

  it('scores bootstrap and checkpoint from their immutable phase snapshots', async () => {
    const { attempt, clock } = readyAttempt()
    const runner = new PhaseVerifierRunner({
      gatesByPhase: {
        bootstrap: [false, false, false, false],
        checkpoint: [true, false, false, false],
        final: [true, true, true, true],
      },
    })
    await runVerificationSuite(attempt, 'visible', runner, clock)
    const heldOut = await runVerificationSuite(
      attempt,
      'held-out',
      runner,
      clock,
    )
    assert.deepEqual(heldOut.verifierGates, {
      bootstrap: false,
      verticalPath: false,
      domainCompleteness: true,
      robustness: true,
    })
    assert.equal(
      buildAttemptReport(attempt, clock).fullFirstAttemptSuccess,
      false,
    )
    assert.deepEqual(runner.heldOutContents, [
      'bootstrap version\n',
      'checkpoint version\n',
      'final version\n',
    ])
  })

  it('preserves valid partial gates from verifier exit 1', async () => {
    const { attempt, clock } = readyAttempt()
    const runner = new PhaseVerifierRunner({
      exitCode: 1,
      gatesByPhase: {
        bootstrap: [true, false, false, false],
        checkpoint: [true, true, false, false],
        final: [true, true, false, false],
      },
    })
    await runVerificationSuite(attempt, 'visible', new FakeRunner(), clock)
    const heldOut = await runVerificationSuite(
      attempt,
      'held-out',
      runner,
      clock,
    )
    assert.equal(heldOut.harnessFailure, undefined)
    assert.deepEqual(heldOut.verifierGates, {
      bootstrap: true,
      verticalPath: true,
      domainCompleteness: false,
      robustness: false,
    })
    assert.equal(heldOut.passed, false)
    assert.equal(heldOut.phaseRuns.every((run) => run.verifierResult), true)
  })

  it('does not report full success when the visible suite fails', async () => {
    const { attempt, clock } = readyAttempt()
    await runVerificationSuite(
      attempt,
      'visible',
      new ExitCodeRunner(1),
      clock,
    )
    await runVerificationSuite(
      attempt,
      'held-out',
      new PhaseVerifierRunner(),
      clock,
    )
    const report = buildAttemptReport(attempt, clock)
    assert.equal(report.visibleVerificationPassed, false)
    assert.equal(report.gates.domainCompleteness, 'failed')
    assert.equal(report.gates.robustness, 'failed')
    assert.equal(report.fullFirstAttemptSuccess, false)
  })

  it('fails the harness for stale or mismatched verifier results', async () => {
    const { attempt, clock } = readyAttempt()
    await runVerificationSuite(attempt, 'visible', new FakeRunner(), clock)
    const heldOut = await runVerificationSuite(
      attempt,
      'held-out',
      new PhaseVerifierRunner({ bindingAttemptId: 'inventory-2' }),
      clock,
    )
    assert.match(
      heldOut.harnessFailure ?? '',
      /binding mismatch for attemptId/,
    )
    assert.equal(heldOut.verifierGates, undefined)
    assert.equal(heldOut.passed, false)

    const planMismatch = readyAttempt()
    await runVerificationSuite(
      planMismatch.attempt,
      'visible',
      new FakeRunner(),
      planMismatch.clock,
    )
    const planMismatchRun = await runVerificationSuite(
      planMismatch.attempt,
      'held-out',
      new PhaseVerifierRunner({
        bindingVerificationPlanSha256: 'c'.repeat(64),
      }),
      planMismatch.clock,
    )
    assert.match(
      planMismatchRun.harnessFailure ?? '',
      /binding mismatch for verificationPlanSha256/,
    )
  })

  it('cannot score an isolation-compromised verifier phase as passing', async () => {
    const { attempt, clock } = readyAttempt()
    await runVerificationSuite(attempt, 'visible', new FakeRunner(), clock)
    const heldOut = await runVerificationSuite(
      attempt,
      'held-out',
      new PhaseVerifierRunner({ exitCode: 1, isolationCompromised: true }),
      clock,
    )
    assert.equal(heldOut.passed, false)
    assert.deepEqual(heldOut.verifierGates, {
      bootstrap: false,
      verticalPath: false,
      domainCompleteness: false,
      robustness: false,
    })

    const verifierFailure = readyAttempt()
    await runVerificationSuite(
      verifierFailure.attempt,
      'visible',
      new FakeRunner(),
      verifierFailure.clock,
    )
    const verifierFailureRun = await runVerificationSuite(
      verifierFailure.attempt,
      'held-out',
      new PhaseVerifierRunner({
        exitCode: 1,
        firstAttemptWithinActiveLimit: false,
      }),
      verifierFailure.clock,
    )
    assert.deepEqual(verifierFailureRun.verifierGates, {
      bootstrap: true,
      verticalPath: true,
      domainCompleteness: true,
      robustness: true,
    })
    assert.equal(verifierFailureRun.passed, false)
  })

  it('fails the harness for missing results and verifier exit 2', async () => {
    const missing = readyAttempt()
    await runVerificationSuite(
      missing.attempt,
      'visible',
      new FakeRunner(),
      missing.clock,
    )
    const missingRun = await runVerificationSuite(
      missing.attempt,
      'held-out',
      new FakeRunner(),
      missing.clock,
    )
    assert.match(missingRun.harnessFailure ?? '', /did not write/)

    const exitTwo = readyAttempt()
    await runVerificationSuite(
      exitTwo.attempt,
      'visible',
      new FakeRunner(),
      exitTwo.clock,
    )
    const exitTwoRun = await runVerificationSuite(
      exitTwo.attempt,
      'held-out',
      new ExitCodeRunner(2),
      exitTwo.clock,
    )
    assert.match(exitTwoRun.harnessFailure ?? '', /command failed/)
  })

})

class TestClock implements Clock {
  private milliseconds: number

  constructor(timestamp: string) {
    this.milliseconds = Date.parse(timestamp)
  }

  now(): Date {
    return new Date(this.milliseconds)
  }

  advance(milliseconds: number): void {
    this.milliseconds += milliseconds
  }
}

class TestScheduler implements WatchdogScheduler {
  callback: (() => void) | undefined
  delayMs: number | undefined

  set(callback: () => void, delayMs: number): unknown {
    this.callback = callback
    this.delayMs = delayMs
    return callback
  }

  clear(): void {
    this.callback = undefined
  }

  fire(): void {
    const callback = this.callback
    if (!callback) throw new Error('No watchdog callback scheduled')
    callback()
  }
}

class FakeRunner implements CommandRunner {
  readonly requests: CommandExecutionRequest[] = []

  run(request: CommandExecutionRequest): Promise<CommandExecutionResult> {
    this.requests.push(request)
    return Promise.resolve({
      exitCode: 0,
      signal: null,
      stdout: 'ok\n',
      stderr: '',
      timedOut: false,
      durationMs: 5,
    })
  }
}

class ExitCodeRunner extends FakeRunner {
  private readonly configuredExitCode: number

  constructor(exitCode: number) {
    super()
    this.configuredExitCode = exitCode
  }

  override async run(
    request: CommandExecutionRequest,
  ): Promise<CommandExecutionResult> {
    const result = await super.run(request)
    return { ...result, exitCode: this.configuredExitCode }
  }
}

class PhaseVerifierRunner extends FakeRunner {
  readonly heldOutContents: string[] = []
  private readonly options: {
    exitCode?: number
    bindingAttemptId?: string
    bindingVerificationPlanSha256?: string
    gatesByPhase?: Partial<Record<string, boolean[]>>
    firstAttemptWithinActiveLimit?: boolean
    isolationCompromised?: boolean
  }

  constructor(options: {
    exitCode?: number
    bindingAttemptId?: string
    bindingVerificationPlanSha256?: string
    gatesByPhase?: Partial<Record<string, boolean[]>>
    firstAttemptWithinActiveLimit?: boolean
    isolationCompromised?: boolean
  } = {}) {
    super()
    this.options = options
  }

  override async run(
    request: CommandExecutionRequest,
  ): Promise<CommandExecutionResult> {
    const phase = request.command.env?.SPECTER_EVALUATION_SNAPSHOT_KIND
    if (!phase) return super.run(request)
    this.heldOutContents.push(
      readFileSync(join(request.cwd, 'app.txt'), 'utf8'),
    )
    const values = this.options.gatesByPhase?.[phase] ??
      [true, true, true, true]
    const gates = [
      'bootstrap',
      'verticalPath',
      'domainCompleteness',
      'robustness',
    ].map((gate, index) => ({ gate, passed: values[index] ?? false }))
    const binding = bindingFromRequest(request)
    if (this.options.bindingAttemptId) {
      binding.attemptId = this.options.bindingAttemptId
    }
    if (this.options.bindingVerificationPlanSha256) {
      binding.verificationPlanSha256 =
        this.options.bindingVerificationPlanSha256
    }
    const resultDirectory = join(request.cwd, 'specter-evaluation')
    mkdirSync(resultDirectory, { recursive: true })
    writeFileSync(
      join(resultDirectory, 'verifier-result.json'),
      JSON.stringify(
        verifierResult(binding, gates, {
          isolationCompromised: this.options.isolationCompromised,
          firstAttemptWithinActiveLimit:
            this.options.firstAttemptWithinActiveLimit,
        }),
      ),
    )
    const base = await super.run(request)
    return {
      ...base,
      exitCode: this.options.exitCode ?? (values.every(Boolean) ? 0 : 1),
    }
  }
}

class MutatingFakeRunner extends FakeRunner {
  readonly observedContents: string[] = []

  override run(
    request: CommandExecutionRequest,
  ): Promise<CommandExecutionResult> {
    this.observedContents.push(
      readFileSync(join(request.cwd, 'app.txt'), 'utf8'),
    )
    writeFileSync(join(request.cwd, 'app.txt'), `${request.command.id}\n`)
    if (request.command.id === 'robustness-check') {
      const resultDirectory = join(request.cwd, 'specter-evaluation')
      mkdirSync(resultDirectory, { recursive: true })
      writeFileSync(
        join(resultDirectory, 'verifier-result.json'),
        JSON.stringify(
          verifierResult(bindingFromRequest(request), allGates(true)),
        ),
      )
    }
    return super.run(request)
  }
}

function bindingFromRequest(
  request: CommandExecutionRequest,
): Record<string, string> {
  const env = request.command.env ?? {}
  return {
    attemptId: env.SPECTER_EVALUATION_ATTEMPT_ID ?? '',
    configSha256: env.SPECTER_EVALUATION_CONFIG_SHA256 ?? '',
    snapshotKind: env.SPECTER_EVALUATION_SNAPSHOT_KIND ?? '',
    snapshotManifestSha256: env.SPECTER_EVALUATION_SNAPSHOT_SHA256 ?? '',
    verificationPlanSha256: 'a'.repeat(64),
  }
}

function allGates(passed: boolean): object[] {
  return [
    { gate: 'bootstrap', passed },
    { gate: 'verticalPath', passed },
    { gate: 'domainCompleteness', passed },
    { gate: 'robustness', passed },
  ]
}

function verifierResult(
  coordinatorBinding: Record<string, string>,
  gates: object[],
  options: {
    remediation?: boolean
    isolationCompromised?: boolean
    firstAttemptWithinActiveLimit?: boolean
  } = {},
): object {
  const gateValues = gates.map((gate) => (gate as { passed: boolean }).passed)
  const allPassed = gateValues.every(Boolean)
  return {
    schemaVersion: 1,
    attempt: {
      id: 'inventory-1',
      domain: 'inventory',
      persistence: 'sqlite',
      topology: 'singleProcess',
      port: 41741,
      activeLimitMinutes: 180,
    },
    coordinatorBinding,
    firstAttempt: {
      gates,
      isolationCompromised: options.isolationCompromised ?? false,
    },
    firstAttemptWithinActiveLimit:
      options.firstAttemptWithinActiveLimit ?? true,
    fullFirstAttemptSuccess:
      allPassed &&
      options.isolationCompromised !== true &&
      options.firstAttemptWithinActiveLimit !== false,
    remediation: options.remediation
      ? {
        phase: 'remediation',
        gates,
        isolationCompromised: false,
        allMandatoryChecksPassed: allPassed,
      }
      : null,
    eventualSuccess: options.remediation ? allPassed : null,
  }
}

function remediationBinding(attempt: string): Record<string, string> {
  const prepared = JSON.parse(
    readFileSync(join(attempt, 'frozen-provenance.json'), 'utf8'),
  ) as { configSha256: string; assignment: { attemptId: string } }
  const state = JSON.parse(
    readFileSync(join(attempt, 'state.json'), 'utf8'),
  ) as {
    remediation: { snapshot: { kind: string; manifestSha256: string } }
  }
  return {
    attemptId: prepared.assignment.attemptId,
    configSha256: prepared.configSha256,
    snapshotKind: state.remediation.snapshot.kind,
    snapshotManifestSha256: state.remediation.snapshot.manifestSha256,
    verificationPlanSha256: 'a'.repeat(64),
  }
}

class FrozenMutationRunner extends FakeRunner {
  private readonly attemptDirectory: string

  constructor(attemptDirectory: string) {
    super()
    this.attemptDirectory = attemptDirectory
  }

  override run(
    request: CommandExecutionRequest,
  ): Promise<CommandExecutionResult> {
    writeFileSync(
      join(
        this.attemptDirectory,
        'first-attempt',
        'artifacts',
        'workspace',
        'app.txt',
      ),
      'tampered\n',
    )
    return super.run(request)
  }
}

function temporaryRoot(): string {
  const directory = mkdtempSync(join(tmpdir(), 'specter-greenfield-runner-'))
  temporaryDirectories.push(directory)
  return join(directory, 'coordinator')
}

function attemptRoots(coordinatorRoot: string): {
  coordinatorRoot: string
  adopterRoot: string
} {
  return {
    coordinatorRoot,
    adopterRoot: join(coordinatorRoot, '..', 'adopter'),
  }
}

function adopterDirectory(attempt: string): string {
  return loadPrepared(attempt).adopterDirectory
}

function startActiveTime(attempt: string, clock: Clock) {
  const prepared = loadPrepared(attempt)
  const publicCanary = join(prepared.adopterDirectory, 'public-canary.txt')
  const privateCanary = join(attempt, 'private-canary.txt')
  writeFileSync(publicCanary, 'public\n')
  writeFileSync(privateCanary, 'private\n')
  recordPassingIsolationAttestation(attempt, {
    schemaVersion: 1,
    attemptId: prepared.assignment.attemptId,
    configSha256: prepared.configSha256,
    coordinatorRoot: attempt,
    adopterRoot: prepared.adopterDirectory,
    publicCanaryPaths: [publicCanary],
    privateCanaryPaths: [privateCanary],
    rehearsedAt: clock.now().toISOString(),
    passed: true,
    publicReadable: [publicCanary],
    privateBlocked: [privateCanary],
    failures: [],
  })
  return startActiveTimeWithoutAttestation(attempt, clock)
}

function readyAttempt(): { attempt: string; clock: TestClock } {
  const root = temporaryRoot()
  const clock = new TestClock('2026-07-18T00:00:00.000Z')
  const attempt = prepareAttempt({
    ...attemptRoots(root),
    assignment: assignment(),
    provenance: provenance(),
    clock,
  })
  writeFileSync(
    join(adopterDirectory(attempt), 'workspace', 'app.txt'),
    'bootstrap version\n',
  )
  startActiveTime(attempt, clock)
  recordMarker(attempt, 'bootstrap', 'passed', undefined, clock)
  writeFileSync(
    join(adopterDirectory(attempt), 'workspace', 'app.txt'),
    'checkpoint version\n',
  )
  recordMarker(attempt, 'checkpoint', 'passed', undefined, clock)
  writeFileSync(
    join(adopterDirectory(attempt), 'workspace', 'app.txt'),
    'final version\n',
  )
  freezeFirstAttempt(attempt, 'passed', undefined, clock)
  return { attempt, clock }
}

function assignment(): object {
  return {
    attemptId: 'inventory-1',
    domainId: 'inventory',
    domainName: 'Inventory Control',
    domainKind: 'replication',
    attemptNumber: 1,
    persistence: 'sqlite',
    topology: 'single-process',
    port: 41741,
    workspacePath: 'workspace',
    freezePaths: ['workspace'],
    visibleCommands: [
      {
        id: 'visible-check',
        file: 'node',
        args: ['--version'],
        cwd: 'workspace',
        timeoutMs: 60_000,
      },
    ],
    heldOutCommands: [
      {
        id: 'robustness-check',
        file: 'node',
        args: ['--version'],
        cwd: 'workspace',
        timeoutMs: 60_000,
      },
    ],
  }
}

function provenance(): object {
  const hash = 'a'.repeat(64)
  const publicKinds = new Set([
    'adopterPrompt',
    'domainBrief',
    'guidance',
    'initializer',
    'semanticCatalog',
    'semanticMapContract',
    'specterPackage',
    'visibleSuite',
  ])
  const artifacts = provenanceArtifactKinds
    .map((kind, index) => ({
      id: `artifact-${index + 1}`,
      audience: publicKinds.has(kind) ? 'public' : 'private',
      kind,
      sha256: hash,
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
  const packageArtifact = artifacts.find(
    (artifact) => artifact.kind === 'specterPackage',
  )
  assert.ok(packageArtifact)
  return {
    specterCommit: 'abcdef0123456789',
    artifactManifestSha256: createHash('sha256')
      .update(stableJson(artifacts))
      .digest('hex'),
    artifacts,
    packages: [
      {
        name: '@specter-ts/core',
        version: '0.3.0',
        artifactId: packageArtifact.id,
        sha256: hash,
      },
    ],
    runtime: {
      model: {
        provider: 'openai',
        id: 'test-model',
        build: 'test-build',
        reasoningSetting: 'test',
        sampler: { seed: 42 },
      },
      agentHarness: { name: 'codex', version: 'test' },
      platform: {
        operatingSystem: 'darwin',
        release: 'test',
        architecture: 'arm64',
      },
      toolchain: {
        node: process.version,
        packageManager: 'pnpm@test',
        browser: 'chromium',
        browserRevision: 'test',
      },
      services: [{ id: 'sqlite', version: 'test' }],
      ...runtimeControls(),
      runOrderSeed: 'test-order',
    },
  }
}

function runtimeControls() {
  const runOrder = Array.from(
    { length: 10 },
    (_, index) => `attempt-${index + 1}`,
  )
  return {
    executionImage: { name: 'test-image', sha256: 'e'.repeat(64) },
    resourceLimits: {
      contextTokens: 200_000,
      cpuCores: 4,
      memoryMiB: 8192,
      activeMinutes: 180 as const,
      checkpointMinutes: 75 as const,
      remediationMinutes: 60 as const,
    },
    dependencyCache: { id: 'test-cache', sha256: 'f'.repeat(64) },
    imageInputs: [],
    runOrder,
    freshContexts: runOrder.map((attemptId, index) => ({
      attemptId,
      taskId: `task-${index + 1}`,
      initialContextTokens: 0,
      freshTask: true as const,
      parentTaskId: null,
    })),
  }
}
