import { isDeepStrictEqual } from 'node:util'
import { standardClaims } from './evidence.js'
import {
  gates,
  type AttemptPhase,
  type CheckDefinition,
  type CheckResult,
  type EvidenceObservation,
  type Gate,
  type GateResult,
  type GreenfieldDriver,
  type JsonValue,
  type PhaseVerificationResult,
  type VerificationOptions,
  type VerificationPlan,
  type VerificationResult,
} from './types.js'
import { validateVerificationPlan } from './validation.js'

const defaultCheckTimeoutMs = 120_000
const defaultSetupTimeoutMs = 30_000
const defaultCleanupTimeoutMs = 10_000
const defaultAbortGraceMs = 5_000
const comparisonRequiredKinds = new Set([
  'acceptedCommandExactEvents',
  'rejectedCommandNoCommit',
])

type Settled<T> =
  | { state: 'resolved'; value: T }
  | { state: 'rejected'; error: unknown }

type Bounded<T> = Settled<T> | { state: 'timedOut' }

interface IsolationOptions {
  abortGraceMs: number
  cleanupTimeoutMs: number
  setupTimeoutMs: number
}

interface IsolatedCheckResult {
  result: CheckResult
  isolationSafe: boolean
}

function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then(
    (value) => ({ state: 'resolved', value }),
    (error: unknown) => ({ state: 'rejected', error }),
  )
}

async function bounded<T>(
  promise: Promise<Settled<T>>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<Bounded<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<{ state: 'timedOut' }>((resolve) => {
    timer = setTimeout(() => {
      onTimeout?.()
      resolve({ state: 'timedOut' })
    }, timeoutMs)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function toJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return value
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value)
  }
  if (Array.isArray(value)) return value.map(toJsonValue)
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toJsonValue(entry)]),
    )
  }
  return String(value)
}

function emptyFailure(
  check: CheckDefinition,
  status: CheckResult['status'],
  durationMs: number,
  diagnostic: string,
): CheckResult {
  return {
    id: check.id,
    title: check.title,
    gate: check.gate,
    visibility: check.visibility,
    mandatory: check.mandatory,
    evidenceKind: check.evidence.kind,
    status,
    durationMs,
    failedClaims: [],
    mismatches: [],
    diagnostics: [diagnostic],
    artifacts: [],
  }
}

function evaluateObservation(
  check: CheckDefinition,
  observation: EvidenceObservation,
  durationMs: number,
): CheckResult {
  if (
    typeof observation !== 'object' ||
    observation === null ||
    typeof observation.claims !== 'object' ||
    observation.claims === null ||
    Array.isArray(observation.claims)
  ) {
    return emptyFailure(
      check,
      'error',
      durationMs,
      'driver returned an invalid observation: claims must be an object',
    )
  }

  const requiredClaims = [
    ...standardClaims[check.evidence.kind],
    ...(check.evidence.additionalClaims ?? []),
  ]
  const failedClaims = requiredClaims.filter(
    (claim) => observation.claims[claim] !== true,
  )
  const invalidClaims = Object.entries(observation.claims)
    .filter(([, value]) => typeof value !== 'boolean')
    .map(([claim]) => claim)
  const comparisons = observation.comparisons ?? []
  const mismatches = comparisons
    .filter(
      (comparison) =>
        !isDeepStrictEqual(comparison.expected, comparison.actual),
    )
    .map((comparison) => ({
      label: comparison.label,
      expected: toJsonValue(comparison.expected),
      actual: toJsonValue(comparison.actual),
    }))
  const missingComparison =
    comparisonRequiredKinds.has(check.evidence.kind) && comparisons.length === 0
  const diagnostics: string[] = []
  if (failedClaims.length > 0) {
    diagnostics.push(`required claims failed: ${failedClaims.join(', ')}`)
  }
  if (invalidClaims.length > 0) {
    diagnostics.push(`claims must be boolean: ${invalidClaims.join(', ')}`)
  }
  if (mismatches.length > 0) {
    diagnostics.push(
      `exact comparisons failed: ${mismatches.map(({ label }) => label).join(', ')}`,
    )
  }
  if (missingComparison) {
    diagnostics.push(
      `${check.evidence.kind} requires at least one exact oracle/actual comparison`,
    )
  }
  const passed =
    failedClaims.length === 0 &&
    invalidClaims.length === 0 &&
    mismatches.length === 0 &&
    !missingComparison
  return {
    id: check.id,
    title: check.title,
    gate: check.gate,
    visibility: check.visibility,
    mandatory: check.mandatory,
    evidenceKind: check.evidence.kind,
    status: passed ? 'passed' : 'failed',
    durationMs,
    failedClaims,
    mismatches,
    diagnostics,
    ...(observation.details === undefined
      ? {}
      : {
          details: toJsonValue(observation.details) as Record<
            string,
            JsonValue
          >,
        }),
    artifacts: [...(observation.artifacts ?? [])].sort(),
  }
}

async function teardownCheck(
  plan: VerificationPlan,
  driver: GreenfieldDriver,
  check: CheckDefinition,
  phase: AttemptPhase,
  reason: 'completed' | 'checkError' | 'timedOut' | 'setupError',
  options: IsolationOptions,
): Promise<{ safe: boolean; diagnostic: string | null }> {
  if (driver.teardown === undefined) return { safe: true, diagnostic: null }
  const controller = new AbortController()
  const teardown = settle(
    driver.teardown({
      attempt: plan.attempt,
      check,
      phase,
      reason,
      signal: controller.signal,
    }),
  )
  const initial = await bounded(teardown, options.cleanupTimeoutMs, () => {
    controller.abort()
  })
  if (initial.state === 'resolved') return { safe: true, diagnostic: null }
  if (initial.state === 'rejected') {
    return {
      safe: false,
      diagnostic: `driver teardown failed: ${messageFrom(initial.error)}`,
    }
  }
  const afterAbort = await bounded(teardown, options.abortGraceMs)
  if (afterAbort.state === 'resolved') {
    return {
      safe: true,
      diagnostic: `driver teardown exceeded ${options.cleanupTimeoutMs}ms but settled after abort`,
    }
  }
  return {
    safe: false,
    diagnostic:
      afterAbort.state === 'rejected'
        ? `driver teardown failed after abort: ${messageFrom(afterAbort.error)}`
        : `driver teardown did not settle within ${options.cleanupTimeoutMs + options.abortGraceMs}ms`,
  }
}

async function executeIsolatedCheck(
  plan: VerificationPlan,
  driver: GreenfieldDriver,
  check: CheckDefinition,
  phase: AttemptPhase,
  now: () => number,
  options: IsolationOptions,
): Promise<IsolatedCheckResult> {
  const setupController = new AbortController()
  if (driver.setup !== undefined) {
    const setup = settle(
      driver.setup({
        attempt: plan.attempt,
        check,
        phase,
        signal: setupController.signal,
      }),
    )
    const setupOutcome = await bounded(setup, options.setupTimeoutMs, () => {
      setupController.abort()
    })
    let setupSettled = setupOutcome.state !== 'timedOut'
    if (!setupSettled) {
      setupSettled =
        (await bounded(setup, options.abortGraceMs)).state !== 'timedOut'
    }
    if (setupOutcome.state !== 'resolved') {
      const cleanup = await teardownCheck(
        plan,
        driver,
        check,
        phase,
        'setupError',
        options,
      )
      if (!setupSettled) {
        setupSettled =
          (await bounded(setup, options.abortGraceMs)).state !== 'timedOut'
      }
      const diagnostic =
        setupOutcome.state === 'rejected'
          ? `driver setup failed: ${messageFrom(setupOutcome.error)}`
          : `driver setup exceeded ${options.setupTimeoutMs}ms`
      const result = emptyFailure(check, 'error', 0, diagnostic)
      if (cleanup.diagnostic !== null)
        result.diagnostics.push(cleanup.diagnostic)
      if (!setupSettled) {
        result.diagnostics.push(
          'driver setup remained active after abort and cleanup',
        )
      }
      return { result, isolationSafe: setupSettled && cleanup.safe }
    }
  }

  const checkController = new AbortController()
  const started = now()
  const run = settle(
    driver.runCheck({
      attempt: plan.attempt,
      check,
      phase,
      signal: checkController.signal,
    }),
  )
  const runOutcome = await bounded(
    run,
    check.timeoutMs ?? defaultCheckTimeoutMs,
    () => checkController.abort(),
  )
  const durationMs = Math.max(0, Math.round(now() - started))

  let runSettled = runOutcome.state !== 'timedOut'
  if (!runSettled) {
    runSettled = (await bounded(run, options.abortGraceMs)).state !== 'timedOut'
  }
  const reason =
    runOutcome.state === 'timedOut'
      ? 'timedOut'
      : runOutcome.state === 'rejected'
        ? 'checkError'
        : 'completed'
  const cleanup = await teardownCheck(
    plan,
    driver,
    check,
    phase,
    reason,
    options,
  )
  if (!runSettled) {
    runSettled = (await bounded(run, options.abortGraceMs)).state !== 'timedOut'
  }

  let result: CheckResult
  if (runOutcome.state === 'timedOut') {
    result = emptyFailure(
      check,
      'timedOut',
      durationMs,
      `check exceeded its ${check.timeoutMs ?? defaultCheckTimeoutMs}ms timeout`,
    )
  } else if (runOutcome.state === 'rejected') {
    result = emptyFailure(
      check,
      'error',
      durationMs,
      messageFrom(runOutcome.error),
    )
  } else {
    result = evaluateObservation(check, runOutcome.value, durationMs)
  }
  if (cleanup.diagnostic !== null) result.diagnostics.push(cleanup.diagnostic)
  if (cleanup.diagnostic !== null && result.status === 'passed') {
    result.status = 'error'
  }
  if (!runSettled) {
    result.status = 'error'
    result.diagnostics.push(
      'driver runCheck remained active after abort and bounded cleanup',
    )
  }
  return { result, isolationSafe: runSettled && cleanup.safe }
}

function calculateGates(checks: readonly CheckResult[]): GateResult[] {
  const results: GateResult[] = []
  let blockedBy: Gate | null = null
  for (const gate of gates) {
    const mandatory = checks.filter(
      (check) => check.gate === gate && check.mandatory,
    )
    const failedCheckIds = mandatory
      .filter((check) => check.status !== 'passed')
      .map((check) => check.id)
      .sort()
    const ownPassed = failedCheckIds.length === 0
    results.push({
      gate,
      passed: ownPassed && blockedBy === null,
      cumulative: true,
      mandatoryChecks: mandatory.length,
      failedCheckIds,
      blockedByEarlierGate: blockedBy,
    })
    if (!ownPassed && blockedBy === null) blockedBy = gate
  }
  return results
}

function finalizePhase(
  phase: AttemptPhase,
  checks: CheckResult[],
  isolationCompromised: boolean,
): PhaseVerificationResult {
  return {
    phase,
    checks,
    gates: calculateGates(checks),
    allMandatoryChecksPassed: checks
      .filter((check) => check.mandatory)
      .every((check) => check.status === 'passed'),
    isolationCompromised,
  }
}

async function executePhase(
  plan: VerificationPlan,
  driver: GreenfieldDriver,
  phase: AttemptPhase,
  now: () => number,
  options: IsolationOptions,
): Promise<PhaseVerificationResult> {
  const orderedChecks = [
    ...plan.checks.filter((check) => check.visibility === 'visible'),
    ...plan.checks.filter((check) => check.visibility === 'heldOut'),
  ]
  const checks: CheckResult[] = []
  for (let index = 0; index < orderedChecks.length; index += 1) {
    const check = orderedChecks[index] as CheckDefinition
    const isolated = await executeIsolatedCheck(
      plan,
      driver,
      check,
      phase,
      now,
      options,
    )
    checks.push(isolated.result)
    if (!isolated.isolationSafe) {
      for (const remaining of orderedChecks.slice(index + 1)) {
        checks.push(
          emptyFailure(
            remaining,
            'error',
            0,
            `not run because isolation was compromised after check "${check.id}"`,
          ),
        )
      }
      return finalizePhase(phase, checks, true)
    }
  }
  return finalizePhase(phase, checks, false)
}

function blockedRemediation(plan: VerificationPlan): PhaseVerificationResult {
  const checks = plan.checks.map((check) =>
    emptyFailure(
      check,
      'error',
      0,
      'remediation not run because first-attempt isolation was compromised',
    ),
  )
  return finalizePhase('remediation', checks, true)
}

export async function verifyGreenfieldAttempt(
  value: unknown,
  driver: GreenfieldDriver,
  options: VerificationOptions = {},
): Promise<VerificationResult> {
  validateVerificationPlan(value)
  if (
    typeof driver?.setup !== 'function' ||
    typeof driver?.runCheck !== 'function' ||
    typeof driver?.teardown !== 'function'
  ) {
    throw new TypeError(
      'driver must implement per-check setup, runCheck, and teardown',
    )
  }
  const plan = value
  const now = options.now ?? Date.now
  const isolationOptions: IsolationOptions = {
    abortGraceMs: options.abortGraceMs ?? defaultAbortGraceMs,
    cleanupTimeoutMs: options.cleanupTimeoutMs ?? defaultCleanupTimeoutMs,
    setupTimeoutMs: options.setupTimeoutMs ?? defaultSetupTimeoutMs,
  }
  const firstAttempt = await executePhase(
    plan,
    driver,
    'firstAttempt',
    now,
    isolationOptions,
  )
  const firstAttemptWithinActiveLimit =
    plan.attempt.firstAttempt.activeMinutes <= plan.attempt.activeLimitMinutes
  const fullFirstAttemptSuccess =
    firstAttemptWithinActiveLimit &&
    !firstAttempt.isolationCompromised &&
    firstAttempt.gates.length === gates.length &&
    firstAttempt.gates.every((gate) => gate.passed)

  const shouldRunRemediation =
    options.runRemediation === true && plan.attempt.remediation !== undefined
  const remediation = shouldRunRemediation
    ? firstAttempt.isolationCompromised
      ? blockedRemediation(plan)
      : await executePhase(plan, driver, 'remediation', now, isolationOptions)
    : null

  return {
    schemaVersion: 1,
    attempt: plan.attempt,
    firstAttempt,
    fullFirstAttemptSuccess,
    firstAttemptWithinActiveLimit,
    remediation,
    eventualSuccess:
      remediation === null
        ? null
        : !remediation.isolationCompromised &&
          remediation.gates.every((gate) => gate.passed),
  }
}

function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJson)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortJson(value[key] as JsonValue)]),
    )
  }
  return value
}

export function stringifyVerificationResult(
  result: VerificationResult,
  space = 2,
): string {
  return `${JSON.stringify(sortJson(result as unknown as JsonValue), null, space)}\n`
}
