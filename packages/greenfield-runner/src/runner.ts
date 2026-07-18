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
  type MarkerKind,
  type MarkerOutcome,
  type PreparedAttempt,
  type RecordedCommandResult,
  type SuiteKind,
  type SuiteRun,
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
  const updated = { ...state, markers: [...state.markers, marker] }
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
  for (const sourcePath of sourcePaths) {
    const source = resolveBelow(attemptDirectory, sourcePath)
    if (!existsSync(source)) {
      throw new Error(`Cannot freeze missing artifact path: ${sourcePath}`)
    }
    assertNoSymlinkComponents(attemptDirectory, sourcePath)
    assertArtifactTreeHasNoSymlinks(source, sourcePath)
  }

  const firstAttemptDirectory = join(attemptDirectory, 'first-attempt')
  if (existsSync(firstAttemptDirectory)) {
    throw new Error(`Refusing to overwrite ${firstAttemptDirectory}`)
  }
  const temporaryDirectory = `${firstAttemptDirectory}.tmp-${randomUUID()}`
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
  renameSync(temporaryDirectory, firstAttemptDirectory)

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
  verifyFrozenIntegrity(attemptDirectory, state)
  const frozenRoot = prepareVerificationWorkspace(
    attemptDirectory,
    kind,
    state.freeze.manifestSha256,
  )
  const verificationArtifacts = relative(attemptDirectory, frozenRoot)
  const logDirectory = join(attemptDirectory, 'logs', 'commands')
  mkdirSync(logDirectory, { recursive: true })
  const startedAt = clock.now().toISOString()
  const results: RecordedCommandResult[] = []

  for (const [index, command] of commands.entries()) {
    const cwd = resolveBelow(frozenRoot, command.cwd)
    if (!existsSync(cwd) || !lstatSync(cwd).isDirectory()) {
      throw new Error(`Command cwd is not a frozen directory: ${command.cwd}`)
    }
    const commandStartedAt = clock.now().toISOString()
    appendChronology(attemptDirectory, clock, 'command-started', {
      suite: kind,
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
    const baseName = `${kind}-${String(index + 1).padStart(2, '0')}-${command.id}`
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
      ...recorded,
    })
  }

  const suite: SuiteRun = {
    kind,
    startedAt,
    finishedAt: clock.now().toISOString(),
    passed: results.every((result) => result.passed),
    verificationArtifacts,
    commands: results,
  }
  if (kind === 'held-out' && suite.passed) {
    const verifierGates = readVerifierGates(
      join(
        frozenRoot,
        'workspace',
        'specter-evaluation',
        'verifier-result.json',
      ),
    )
    Object.assign(suite, {
      verifierGates,
      passed: Object.values(verifierGates).every(Boolean),
    })
  }
  verifyFrozenIntegrity(attemptDirectory, state)
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
  const resultBytes = readFileSync(resolve(verificationResultPath))
  const result = JSON.parse(resultBytes.toString('utf8')) as unknown
  if (
    typeof result !== 'object' ||
    result === null ||
    (result as { schemaVersion?: unknown }).schemaVersion !== 1 ||
    typeof (result as { eventualSuccess?: unknown }).eventualSuccess !==
      'boolean' ||
    (result as { remediation?: unknown }).remediation === null
  ) {
    throw new Error(
      'Remediation result must be a verifier result with a completed remediation phase',
    )
  }
  const outcome: 'passed' | 'failed' = (result as { eventualSuccess: boolean })
    .eventualSuccess
    ? 'passed'
    : 'failed'
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

function readVerifierGates(path: string): {
  bootstrap: boolean
  verticalPath: boolean
  domainCompleteness: boolean
  robustness: boolean
} {
  if (!existsSync(path)) {
    throw new Error(`Held-out verifier did not write ${path}`)
  }
  const value = readJson(path) as {
    schemaVersion?: unknown
    firstAttempt?: { gates?: unknown }
  }
  if (value.schemaVersion !== 1 || !Array.isArray(value.firstAttempt?.gates)) {
    throw new Error('Held-out verifier result has an invalid result shape')
  }
  const output = {} as Record<string, boolean>
  for (const entry of value.firstAttempt.gates) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      ![
        'bootstrap',
        'verticalPath',
        'domainCompleteness',
        'robustness',
      ].includes(String((entry as { gate?: unknown }).gate)) ||
      typeof (entry as { passed?: unknown }).passed !== 'boolean'
    ) {
      throw new Error('Held-out verifier result contains an invalid gate')
    }
    output[String((entry as { gate: string }).gate)] = (
      entry as { passed: boolean }
    ).passed
  }
  for (const gate of [
    'bootstrap',
    'verticalPath',
    'domainCompleteness',
    'robustness',
  ]) {
    if (typeof output[gate] !== 'boolean') {
      throw new Error(`Held-out verifier result is missing gate ${gate}`)
    }
  }
  return output as {
    bootstrap: boolean
    verticalPath: boolean
    domainCompleteness: boolean
    robustness: boolean
  }
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

function prepareVerificationWorkspace(
  attemptDirectory: string,
  kind: SuiteKind,
  expectedManifestSha256: string,
): string {
  const verificationRoot = join(attemptDirectory, 'verification')
  if (
    existsSync(verificationRoot) &&
    lstatSync(verificationRoot).isSymbolicLink()
  ) {
    throw new Error('Symlinks are not allowed in the verification directory')
  }
  mkdirSync(verificationRoot, { recursive: true })
  const suiteDirectory = join(verificationRoot, kind)
  if (existsSync(suiteDirectory)) {
    throw new Error(
      `Refusing to overwrite verification workspace: ${suiteDirectory}`,
    )
  }
  const temporaryDirectory = join(
    verificationRoot,
    `.${kind}.tmp-${randomUUID()}`,
  )
  const artifactsDirectory = join(temporaryDirectory, 'artifacts')
  cpSync(
    join(attemptDirectory, 'first-attempt', 'artifacts'),
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
    `verification/${kind}/artifacts`,
  )
  const copiedManifestSha256 = sha256(
    stableJson(artifactManifest(artifactsDirectory)),
  )
  if (copiedManifestSha256 !== expectedManifestSha256) {
    throw new Error(
      `Verification artifact copy failed integrity check: expected ${expectedManifestSha256}, received ${copiedManifestSha256}`,
    )
  }
  renameSync(temporaryDirectory, suiteDirectory)
  return join(suiteDirectory, 'artifacts')
}

function verifyFrozenIntegrity(
  attemptDirectory: string,
  state: AttemptState,
): void {
  if (!state.freeze) throw new Error('First-attempt freeze metadata is missing')
  const frozenRoot = join(attemptDirectory, 'first-attempt', 'artifacts')
  assertArtifactTreeHasNoSymlinks(frozenRoot, 'first-attempt/artifacts')
  const actualSha256 = sha256(stableJson(artifactManifest(frozenRoot)))
  if (actualSha256 !== state.freeze.manifestSha256) {
    throw new Error(
      `Frozen artifact integrity check failed: expected ${state.freeze.manifestSha256}, received ${actualSha256}`,
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
