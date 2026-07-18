import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { canonicalEvidencePlacement, standardClaims } from './evidence.js'
import {
  stringifyVerificationResult,
  verifyGreenfieldAttempt,
} from './runner.js'
import type {
  CheckDefinition,
  EvidenceKind,
  GreenfieldDriver,
  ProjectSemanticAdapter,
  VerificationPlan,
} from './types.js'
import { PlanValidationError, validateVerificationPlan } from './validation.js'

function check(kind: EvidenceKind, suffix = ''): CheckDefinition {
  const placement = canonicalEvidencePlacement[kind]
  return {
    id: `${kind}${suffix}`,
    title: `${kind} ${suffix}`.trim(),
    gate: placement.gate,
    visibility: placement.visibility,
    mandatory: true,
    evidence: { kind, description: `Prove ${kind}` },
  }
}

function validPlan(
  persistence: 'sqlite' | 'postgres' = 'sqlite',
): VerificationPlan {
  const requiredKinds: EvidenceKind[] = [
    'starterBaseline',
    'scenarioCoverage',
    'wholeAppScenarioCoverage',
    'acceptedCommandExactEvents',
    'rejectedCommandNoCommit',
    'invalidInputNoCommit',
    'idempotentDuplicate',
    'concurrentDecision',
    'restartEquivalence',
    'projectionCatchUp',
    'projectionReplayRepair',
    'cursorPublicationSafety',
    'eventGlobalOrder',
    'commandReactionCompletion',
    'reactionDeliveryRecovery',
    'httpJsonBoundary',
    'httpErrorBoundary',
    'sseLifecycle',
  ]
  const transcriptSha256 = 'a'.repeat(64)
  const generators = [
    ...(['command', 'query', 'reaction'] as const).flatMap(
      (sliceKind, index) => [
        {
          generator: 'slice' as const,
          mode: 'dryRun' as const,
          target: `first-${sliceKind}`,
          sliceKind,
          activeMinute: index * 10 + 10,
          transcriptSha256,
          succeeded: true,
        },
        {
          generator: 'slice' as const,
          mode: 'generate' as const,
          target: `first-${sliceKind}`,
          sliceKind,
          activeMinute: index * 10 + 11,
          transcriptSha256,
          succeeded: true,
          disposition: 'changed' as const,
          rationale: 'Adapted the generated files to the brief.',
        },
      ],
    ),
    ...(persistence === 'sqlite'
      ? [
          {
            generator: 'persistentHarness' as const,
            mode: 'dryRun' as const,
            target: 'recovery',
            activeMinute: 40,
            transcriptSha256,
            succeeded: true,
          },
          {
            generator: 'persistentHarness' as const,
            mode: 'generate' as const,
            target: 'recovery',
            activeMinute: 41,
            transcriptSha256,
            succeeded: true,
            disposition: 'kept' as const,
            rationale: 'Generated harness matched the assigned profile.',
          },
        ]
      : []),
  ]
  return {
    schemaVersion: 1,
    attempt: {
      id: 'cold-chain-a',
      domain: 'cold-chain freight control',
      persistence,
      topology: persistence === 'sqlite' ? 'singleProcess' : 'multiProcess',
      port: 41733,
      specterVersion: '0.3.0+frozen',
      activeLimitMinutes: 180,
      firstAttempt: {
        startedAt: '2026-07-18T12:00:00.000Z',
        frozenAt: '2026-07-18T15:00:00.000Z',
        activeMinutes: 179,
        wallMinutes: 180,
        iterations: 12,
        sliceKindsUsed: ['command', 'query', 'reaction'],
        firstSliceUses: [
          { sliceKind: 'command', target: 'first-command', activeMinute: 12 },
          { sliceKind: 'query', target: 'first-query', activeMinute: 22 },
          {
            sliceKind: 'reaction',
            target: 'first-reaction',
            activeMinute: 32,
          },
        ],
        ...(persistence === 'sqlite'
          ? {
              persistentHarnessFirstUse: {
                target: 'recovery',
                activeMinute: 42,
              },
            }
          : {}),
        phases: [
          {
            phase: 'bootstrap',
            activeMinutes: 10,
            wallMinutes: 11,
            iterations: 1,
            sourceConsultations: [],
            generatorInvocations: [],
          },
          {
            phase: 'verticalPath',
            activeMinutes: 50,
            wallMinutes: 52,
            iterations: 4,
            sourceConsultations: [
              { source: 'Specter skill', reason: 'Scenario contract' },
            ],
            generatorInvocations: generators,
          },
          {
            phase: 'completeApp',
            activeMinutes: 119,
            wallMinutes: 117,
            iterations: 7,
            sourceConsultations: [],
            generatorInvocations: [],
          },
        ],
      },
    },
    checks: [
      ...requiredKinds.map((kind) => check(kind)),
      check('browserJourney', '-happy'),
      check('browserJourney', '-guarded'),
      ...(persistence === 'sqlite'
        ? [check('sqliteRecovery')]
        : [check('postgresSerialization'), check('postgresOutboxClaim')]),
    ],
  }
}

function passingDriver(
  overrides: Record<string, boolean> = {},
): GreenfieldDriver {
  const adapter: ProjectSemanticAdapter = {
    async probe({ semanticId, capability }) {
      return {
        value: { semanticId, capability, observed: true },
        artifacts: ['z.log', 'a.json'],
      }
    },
  }
  return {
    async setup() {},
    async runCheck({ check, phase, signal }) {
      const observed = await adapter.probe({
        semanticId: `brief.${check.evidence.kind}`,
        capability:
          check.evidence.kind === 'browserJourney' ? 'browser' : 'query',
        phase,
        signal,
      })
      return {
        claims: Object.fromEntries(
          standardClaims[check.evidence.kind].map((claim) => [
            claim,
            overrides[`${check.id}:${claim}`] ?? true,
          ]),
        ),
        comparisons: [
          {
            label: 'stable oracle',
            expected: { ok: true },
            actual: { ok: true },
          },
        ],
        artifacts: observed.artifacts,
      }
    },
    async teardown() {},
  }
}

describe('verifyGreenfieldAttempt', () => {
  it('passes all four cumulative gates and emits deterministic JSON', async () => {
    const plan = validPlan()
    const result = await verifyGreenfieldAttempt(plan, passingDriver(), {
      now: () => 100,
    })

    assert.equal(result.fullFirstAttemptSuccess, true)
    assert.deepEqual(
      result.firstAttempt.gates.map((gate) => gate.passed),
      [true, true, true, true],
    )
    assert.deepEqual(result.firstAttempt.checks[0]?.artifacts, [
      'a.json',
      'z.log',
    ])
    assert.equal(
      stringifyVerificationResult(result),
      stringifyVerificationResult(result),
    )
    assert.match(
      stringifyVerificationResult(result),
      /"fullFirstAttemptSuccess": true/,
    )
  })

  it('blocks later cumulative gates when an earlier mandatory check fails', async () => {
    const plan = validPlan()
    const result = await verifyGreenfieldAttempt(
      plan,
      passingDriver({
        'rejectedCommandNoCommit:noEventsCommitted': false,
      }),
      { now: () => 100 },
    )

    assert.equal(result.fullFirstAttemptSuccess, false)
    assert.equal(result.firstAttempt.gates[1]?.gate, 'verticalPath')
    assert.equal(result.firstAttempt.gates[1]?.passed, false)
    assert.deepEqual(result.firstAttempt.gates[1]?.failedCheckIds, [
      'rejectedCommandNoCommit',
    ])
    assert.equal(result.firstAttempt.gates[2]?.gate, 'domainCompleteness')
    assert.equal(result.firstAttempt.gates[2]?.passed, false)
    assert.equal(
      result.firstAttempt.gates[2]?.blockedByEarlierGate,
      'verticalPath',
    )
  })

  it('keeps remediation separate and never changes a timed-out first result', async () => {
    const plan = validPlan()
    plan.attempt.firstAttempt.activeMinutes = 181
    plan.attempt.firstAttempt.wallMinutes = 190
    const completeApp = plan.attempt.firstAttempt.phases.find(
      (phase) => phase.phase === 'completeApp',
    )
    assert.ok(completeApp)
    completeApp.activeMinutes = 121
    completeApp.wallMinutes = 127
    plan.attempt.remediation = {
      startedAt: '2026-07-18T16:00:00.000Z',
      frozenAt: '2026-07-18T16:30:00.000Z',
      activeMinutes: 25,
      wallMinutes: 30,
      iterations: 2,
      sourceConsultations: [
        { source: 'verifier findings', reason: 'remediation' },
      ],
    }
    const result = await verifyGreenfieldAttempt(plan, passingDriver(), {
      runRemediation: true,
      now: () => 100,
    })

    assert.equal(result.firstAttemptWithinActiveLimit, false)
    assert.equal(result.fullFirstAttemptSuccess, false)
    assert.equal(result.remediation?.phase, 'remediation')
    assert.equal(result.eventualSuccess, true)
  })

  it('fails exact evidence mismatches even when driver claims pass', async () => {
    const driver = passingDriver()
    driver.runCheck = async ({ check }) => ({
      claims: Object.fromEntries(
        standardClaims[check.evidence.kind].map((claim) => [claim, true]),
      ),
      comparisons: [
        { label: 'durable events', expected: ['accepted'], actual: ['other'] },
      ],
    })
    const result = await verifyGreenfieldAttempt(validPlan(), driver, {
      now: () => 100,
    })

    assert.equal(
      result.firstAttempt.checks.every((item) => item.status === 'failed'),
      true,
    )
    assert.equal(
      result.firstAttempt.checks[0]?.mismatches[0]?.label,
      'durable events',
    )
  })

  it('resets every check and waits for abort-aware work before continuing', async () => {
    const plan = validPlan()
    const first = plan.checks[0] as CheckDefinition
    first.timeoutMs = 1
    const base = passingDriver()
    let setups = 0
    let teardowns = 0
    let runs = 0
    const driver: GreenfieldDriver = {
      async setup() {
        setups += 1
      },
      async runCheck(context) {
        runs += 1
        if (context.check.id === first.id) {
          await new Promise<void>((resolve) => {
            context.signal.addEventListener('abort', () => resolve(), {
              once: true,
            })
          })
        }
        return base.runCheck(context)
      },
      async teardown() {
        teardowns += 1
      },
    }

    const result = await verifyGreenfieldAttempt(plan, driver, {
      abortGraceMs: 5,
      cleanupTimeoutMs: 5,
      setupTimeoutMs: 5,
    })

    assert.equal(result.firstAttempt.checks[0]?.status, 'timedOut')
    assert.equal(result.firstAttempt.checks[1]?.status, 'passed')
    assert.equal(result.firstAttempt.isolationCompromised, false)
    assert.equal(setups, plan.checks.length)
    assert.equal(teardowns, plan.checks.length)
    assert.equal(runs, plan.checks.length)
  })

  it('stops the phase when aborted work remains active after cleanup', async () => {
    const plan = validPlan()
    const first = plan.checks[0] as CheckDefinition
    first.timeoutMs = 1
    const base = passingDriver()
    let runs = 0
    const driver: GreenfieldDriver = {
      async setup() {},
      async runCheck(context) {
        runs += 1
        if (context.check.id === first.id) return new Promise(() => {})
        return base.runCheck(context)
      },
      async teardown() {},
    }

    const result = await verifyGreenfieldAttempt(plan, driver, {
      abortGraceMs: 1,
      cleanupTimeoutMs: 1,
      setupTimeoutMs: 1,
    })

    assert.equal(runs, 1)
    assert.equal(result.firstAttempt.isolationCompromised, true)
    assert.equal(result.firstAttempt.checks[0]?.status, 'error')
    assert.match(
      result.firstAttempt.checks[1]?.diagnostics.join('\n') ?? '',
      /not run because isolation was compromised/,
    )
  })

  it('bounds teardown and stops before another check when cleanup hangs', async () => {
    const plan = validPlan()
    const first = plan.checks[0] as CheckDefinition
    const base = passingDriver()
    let runs = 0
    const driver: GreenfieldDriver = {
      async setup() {},
      async runCheck(context) {
        runs += 1
        return base.runCheck(context)
      },
      async teardown({ check }) {
        if (check.id === first.id) return new Promise(() => {})
      },
    }

    const result = await verifyGreenfieldAttempt(plan, driver, {
      abortGraceMs: 1,
      cleanupTimeoutMs: 1,
      setupTimeoutMs: 1,
    })

    assert.equal(runs, 1)
    assert.equal(result.firstAttempt.isolationCompromised, true)
    assert.equal(result.firstAttempt.checks[0]?.status, 'error')
    assert.match(
      result.firstAttempt.checks[0]?.diagnostics.join('\n') ?? '',
      /driver teardown did not settle/,
    )
  })
})

describe('validateVerificationPlan', () => {
  it('reports multiple actionable protocol omissions together', () => {
    const plan = validPlan()
    plan.attempt.port = 65_536
    plan.checks = plan.checks.filter(
      (item) =>
        item.evidence.kind !== 'reactionDeliveryRecovery' &&
        item.evidence.kind !== 'sqliteRecovery',
    )

    assert.throws(() => validateVerificationPlan(plan), PlanValidationError)
    try {
      validateVerificationPlan(plan)
    } catch (error) {
      assert.ok(error instanceof PlanValidationError)
      for (const issue of [
        'attempt.port must be an integer between 10000 and 65535',
        'mandatory evidence kind reactionDeliveryRecovery is required by the protocol',
        'persistence profile requires mandatory sqliteRecovery evidence',
      ]) {
        assert.ok(error.issues.includes(issue), `missing issue: ${issue}`)
      }
    }
  })

  it('requires Postgres-specific multi-process and outbox evidence', () => {
    const plan = validPlan('postgres')
    plan.checks = plan.checks.filter(
      (item) => item.evidence.kind !== 'postgresOutboxClaim',
    )

    assert.throws(
      () => validateVerificationPlan(plan),
      /Postgres profile requires mandatory postgresOutboxClaim evidence/,
    )
  })

  it('enforces generator chronology, transcripts, and all three first uses', () => {
    const plan = validPlan()
    const invocation = plan.attempt.firstAttempt.phases
      .flatMap((phase) => phase.generatorInvocations)
      .find(
        (entry) =>
          entry.generator === 'slice' &&
          entry.sliceKind === 'command' &&
          entry.mode === 'dryRun',
      )
    assert.ok(invocation)
    invocation.activeMinute = 11
    invocation.transcriptSha256 = 'not-a-hash'
    plan.attempt.firstAttempt.sliceKindsUsed = ['command', 'query']
    plan.attempt.firstAttempt.firstSliceUses =
      plan.attempt.firstAttempt.firstSliceUses.filter(
        (entry) => entry.sliceKind !== 'reaction',
      )

    assert.throws(
      () => validateVerificationPlan(plan),
      /sliceKindsUsed must contain exactly command, query, and reaction once each/,
    )
    assert.throws(
      () => validateVerificationPlan(plan),
      /transcriptSha256 must be 64 lowercase hex characters/,
    )
    assert.throws(
      () => validateVerificationPlan(plan),
      /dryRun before generate/,
    )
    assert.throws(
      () => validateVerificationPlan(plan),
      /exactly one reaction record/,
    )
  })

  it('rejects evidence outside its canonical gate and visibility', () => {
    const plan = validPlan()
    const checkToMove = plan.checks.find(
      (entry) => entry.evidence.kind === 'reactionDeliveryRecovery',
    )
    assert.ok(checkToMove)
    checkToMove.gate = 'domainCompleteness'
    checkToMove.visibility = 'visible'

    assert.throws(
      () => validateVerificationPlan(plan),
      /reactionDeliveryRecovery must be heldOut in gate robustness/,
    )
  })
})
