import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'

import {
  buildAggregateReport,
  prepareAttempt,
  provenanceArtifactKinds,
  recordPassingIsolationAttestation,
  stableJson,
  type FrozenProvenance,
  type MatrixEntry,
  type PreparedAttempt,
} from '../dist/index.js'

describe('aggregate report controls', () => {
  it('accepts a complete matrix while allowing artifacts to vary by domain', () => {
    const fixture = completeFixture()

    const report = buildAggregateReport(fixture.attempts, fixture.matrix)

    assert.equal(report.attempts.length, 10)
    assert.equal(report.byDomainKind.replication.attempts, 6)
    assert.equal(report.byDomainKind.transfer.attempts, 4)
    assert.equal(report.byPersistence.sqlite.attempts, 6)
    assert.equal(report.byPersistence.postgres.attempts, 4)
  })

  it('rejects missing, extra, and matrix-drifted attempts', () => {
    const missing = completeFixture()
    assert.throws(
      () => buildAggregateReport(missing.attempts.slice(1), missing.matrix),
      /missing: domain-1-1/,
    )

    const extra = completeFixture()
    const extraAssignment = {
      ...extra.matrix[0],
      attemptId: 'unexpected-1',
      domainId: 'unexpected',
      domainName: 'Unexpected',
      port: 42999,
    } satisfies MatrixEntry
    const extraAttempt = prepareAttempt({
      coordinatorRoot: extra.coordinatorRoot,
      adopterRoot: extra.adopterRoot,
      assignment: extraAssignment,
      provenance: provenance('unexpected'),
    })
    assert.throws(
      () =>
        buildAggregateReport(
          [...extra.attempts, extraAttempt],
          extra.matrix,
        ),
      /unexpected: unexpected-1/,
    )

    const drifted = completeFixture()
    mutatePrepared(drifted.attempts[0]!, (prepared) => ({
      ...prepared,
      assignment: { ...prepared.assignment, domainName: 'Drifted Domain' },
    }))
    assert.throws(
      () => buildAggregateReport(drifted.attempts, drifted.matrix),
      /assignment drifted from the expected matrix/,
    )
  })

  it('rejects absent verifier evidence and held-out harness failures', () => {
    const absent = completeFixture()
    mutateState(absent.attempts[0]!, (state) => ({
      ...state,
      suites: {},
    }))
    assert.throws(
      () => buildAggregateReport(absent.attempts, absent.matrix),
      /missing held-out verifier results/,
    )

    const failed = completeFixture()
    mutateState(failed.attempts[0]!, (state) => ({
      ...state,
      suites: {
        ...state.suites,
        'held-out': {
          ...state.suites['held-out'],
          harnessFailure: 'coordinator crashed',
        },
      },
    }))
    assert.throws(
      () => buildAggregateReport(failed.attempts, failed.matrix),
      /held-out harness failure: coordinator crashed/,
    )

    const missingFile = completeFixture()
    mutateState(missingFile.attempts[0]!, (state) => {
      const heldOut = state.suites['held-out'] as Record<string, unknown>
      const phaseRuns = heldOut.phaseRuns as Array<Record<string, unknown>>
      const firstRun = phaseRuns[0]!
      const verifierResult = firstRun.verifierResult as Record<string, unknown>
      return {
        ...state,
        suites: {
          ...state.suites,
          'held-out': {
            ...heldOut,
            phaseRuns: [
              {
                ...firstRun,
                verifierResult: {
                  ...verifierResult,
                  path: 'verifier-results/held-out/absent.json',
                },
              },
              ...phaseRuns.slice(1),
            ],
          },
        },
      }
    })
    assert.throws(
      () => buildAggregateReport(missingFile.attempts, missingFile.matrix),
      /missing held-out verifier result file/,
    )
  })

  it('rejects runtime, package, shared-artifact, and same-domain drift', () => {
    for (const [label, mutate, expected] of [
      [
        'runtime',
        (value: FrozenProvenance): FrozenProvenance => ({
          ...value,
          runtime: {
            ...value.runtime,
            model: { ...value.runtime.model, build: 'drifted-build' },
          },
        }),
        /runtime control drift/,
      ],
      [
        'package',
        (value: FrozenProvenance): FrozenProvenance => ({
          ...value,
          packages: value.packages.map((item) => ({
            ...item,
            version: '0.3.1',
          })),
        }),
        /package control drift/,
      ],
      [
        'shared artifact',
        (value: FrozenProvenance): FrozenProvenance =>
          replaceArtifact(value, 'guidance', 'b'.repeat(64)),
        /shared artifact control drift/,
      ],
      [
        'same-domain artifact',
        (value: FrozenProvenance): FrozenProvenance =>
          replaceArtifact(value, 'domainBrief', 'c'.repeat(64)),
        /domain artifact drift/,
      ],
    ] as const) {
      const fixture = completeFixture()
      mutateProvenance(fixture.attempts[1]!, mutate)
      assert.throws(
        () => buildAggregateReport(fixture.attempts, fixture.matrix),
        expected,
        label,
      )
    }
  })

  it('rejects execution outside the preregistered two-block order', () => {
    const fixture = completeFixture()
    mutateState(fixture.attempts[0]!, (state) => {
      const timer = state.timer as Record<string, unknown>
      const sessions = timer.sessions as Array<Record<string, unknown>>
      return {
        ...state,
        timer: {
          ...timer,
          sessions: [
            {
              ...sessions[0],
              startedAt: '2026-07-18T23:59:00.000Z',
            },
          ],
        },
      }
    })

    assert.throws(
      () => buildAggregateReport(fixture.attempts, fixture.matrix),
      /did not follow the frozen two-block order/,
    )
  })
})

function completeFixture(): {
  attempts: string[]
  matrix: MatrixEntry[]
  coordinatorRoot: string
  adopterRoot: string
} {
  const root = mkdtempSync(join(tmpdir(), 'specter-report-'))
  const coordinatorRoot = join(root, 'coordinator')
  const adopterRoot = join(root, 'adopter')
  const matrix = completeMatrix()
  const scheduledMatrix = [...matrix].sort(
    (left, right) =>
      left.attemptNumber - right.attemptNumber ||
      left.domainId.localeCompare(right.domainId),
  )
  const attempts = scheduledMatrix.map((assignment, index) => {
    const attempt = prepareAttempt({
      coordinatorRoot,
      adopterRoot,
      assignment,
      provenance: provenance(assignment.domainId),
    })
    seedIsolationAttestation(attempt)
    seedHeldOutEvidence(attempt, index)
    return attempt
  })
  return { attempts, matrix, coordinatorRoot, adopterRoot }
}

function seedIsolationAttestation(attempt: string): void {
  const prepared = json<PreparedAttempt>(join(attempt, 'frozen-provenance.json'))
  const publicCanary = join(prepared.adopterDirectory, 'public-canary.txt')
  const privateCanary = join(attempt, 'private-canary.txt')
  writeFileSync(publicCanary, 'public')
  writeFileSync(privateCanary, 'private')
  recordPassingIsolationAttestation(attempt, {
    schemaVersion: 1,
    attemptId: prepared.assignment.attemptId,
    configSha256: prepared.configSha256,
    coordinatorRoot: attempt,
    adopterRoot: prepared.adopterDirectory,
    publicCanaryPaths: [publicCanary],
    privateCanaryPaths: [privateCanary],
    rehearsedAt: prepared.preparedAt,
    passed: true,
    publicReadable: [publicCanary],
    privateBlocked: [privateCanary],
    failures: [],
  })
}

function completeMatrix(): MatrixEntry[] {
  return Array.from({ length: 5 }, (_, index) => {
    const domainNumber = index + 1
    const domainId = `domain-${domainNumber}`
    const replication = domainNumber <= 3
    return ([1, 2] as const).map((attemptNumber) => ({
      attemptId: `${domainId}-${attemptNumber}`,
      domainId,
      domainName: `Domain ${domainNumber}`,
      domainKind: replication ? 'replication' : 'transfer',
      attemptNumber,
      persistence: replication ? 'sqlite' : 'postgres',
      topology: replication ? 'single-process' : 'multi-process',
      port: 42000 + domainNumber,
      workspacePath: 'workspace',
      freezePaths: ['workspace'],
      visibleCommands: [command('visible')],
      heldOutCommands: [command('held-out')],
    } satisfies MatrixEntry))
  }).flat()
}

function command(id: string) {
  return {
    id,
    file: process.execPath,
    args: ['--version'],
    cwd: 'workspace',
    timeoutMs: 1_000,
  }
}

function provenance(domainId: string): FrozenProvenance {
  const sharedSha256 = 'a'.repeat(64)
  const domainSha256 = createHash('sha256').update(domainId).digest('hex')
  const domainSpecificKinds = new Set([
    'browserFixture',
    'checkCases',
    'domainBrief',
    'heldOutSuite',
    'serviceFixture',
    'verificationPlan',
    'visibleSuite',
  ])
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
      audience: publicKinds.has(kind) ? ('public' as const) : ('private' as const),
      kind,
      sha256: domainSpecificKinds.has(kind) ? domainSha256 : sharedSha256,
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
        sha256: packageArtifact.sha256,
      },
    ],
    runtime: {
      model: {
        provider: 'openai',
        id: 'test-model',
        build: 'test-build',
        reasoningSetting: 'high',
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
      services: [{ id: 'database', version: 'test' }],
      ...runtimeControls(),
      runOrderSeed: 'test-order',
    },
  }
}

function seedHeldOutEvidence(attempt: string, executionIndex: number): void {
  const prepared = json<PreparedAttempt>(join(attempt, 'frozen-provenance.json'))
  const state = json<Record<string, unknown>>(join(attempt, 'state.json'))
  const phaseRuns = (['bootstrap', 'checkpoint', 'final'] as const).map(
    (kind) => {
      const bytes = Buffer.from(`${prepared.assignment.attemptId}:${kind}\n`)
      const resultPath = `verifier-results/held-out/${kind}.json`
      const absoluteResultPath = join(attempt, resultPath)
      mkdirSync(dirname(absoluteResultPath), { recursive: true })
      writeFileSync(absoluteResultPath, bytes)
      const snapshotManifestSha256 = createHash('sha256')
        .update(`snapshot:${kind}`)
        .digest('hex')
      return {
        snapshot: {
          kind,
          capturedAt: prepared.preparedAt,
          sourcePaths: ['workspace'],
          manifestSha256: snapshotManifestSha256,
        },
        verificationArtifacts: `verification/held-out/${kind}/artifacts`,
        commands: [],
        commandPassed: true,
        verifierResult: {
          path: resultPath,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          binding: {
            attemptId: prepared.assignment.attemptId,
            configSha256: prepared.configSha256,
            snapshotKind: kind,
            snapshotManifestSha256,
            verificationPlanSha256:
              prepared.provenance.artifacts.find(
                (artifact) => artifact.kind === 'verificationPlan',
              )?.sha256,
          },
          fullFirstAttemptSuccess: true,
          isolationCompromised: false,
          gates: {
            bootstrap: true,
            verticalPath: true,
            domainCompleteness: true,
            robustness: true,
          },
        },
      }
    },
  )
  state.suites = {
    'held-out': {
      kind: 'held-out',
      startedAt: prepared.preparedAt,
      finishedAt: prepared.preparedAt,
      passed: true,
      verificationArtifacts: 'verification/held-out/final/artifacts',
      commands: [],
      phaseRuns,
      verifierGates: {
        bootstrap: true,
        verticalPath: true,
        domainCompleteness: true,
        robustness: true,
      },
    },
  }
  state.timer = {
    ...(state.timer as Record<string, unknown>),
    accumulatedMs: 1,
    sessions: [
      {
        startedAt: new Date(Date.UTC(2026, 6, 18, 0, executionIndex)).toISOString(),
        stoppedAt: new Date(
          Date.UTC(2026, 6, 18, 0, executionIndex, 1),
        ).toISOString(),
        elapsedMs: 1,
      },
    ],
  }
  writeFileSync(join(attempt, 'state.json'), `${stableJson(state)}\n`)
}

function runtimeControls() {
  const runOrder = ([1, 2] as const).flatMap((attemptNumber) =>
    Array.from(
      { length: 5 },
      (_, index) => `domain-${index + 1}-${attemptNumber}`,
    ),
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

function mutatePrepared(
  attempt: string,
  mutate: (prepared: PreparedAttempt) => PreparedAttempt,
): void {
  const path = join(attempt, 'frozen-provenance.json')
  const prepared = mutate(json<PreparedAttempt>(path))
  const configSha256 = createHash('sha256')
    .update(
      stableJson({
        assignment: prepared.assignment,
        provenance: prepared.provenance,
      }),
    )
    .digest('hex')
  writeFileSync(path, `${stableJson({ ...prepared, configSha256 })}\n`)
}

function mutateProvenance(
  attempt: string,
  mutate: (provenance: FrozenProvenance) => FrozenProvenance,
): void {
  mutatePrepared(attempt, (prepared) => ({
    ...prepared,
    provenance: mutate(prepared.provenance),
  }))
  const prepared = json<PreparedAttempt>(join(attempt, 'frozen-provenance.json'))
  const attestationPath = join(attempt, 'isolation-attestation.json')
  const attestation = json<Record<string, unknown>>(attestationPath)
  writeFileSync(
    attestationPath,
    `${stableJson({ ...attestation, configSha256: prepared.configSha256 })}\n`,
  )
  mutateState(attempt, (state) => {
    const heldOut = state.suites['held-out'] as Record<string, unknown>
    const phaseRuns = heldOut.phaseRuns as Array<Record<string, unknown>>
    return {
      ...state,
      suites: {
        ...state.suites,
        'held-out': {
          ...heldOut,
          phaseRuns: phaseRuns.map((run) => {
            const verifierResult = run.verifierResult as Record<string, unknown>
            const binding = verifierResult.binding as Record<string, unknown>
            return {
              ...run,
              verifierResult: {
                ...verifierResult,
                binding: { ...binding, configSha256: prepared.configSha256 },
              },
            }
          }),
        },
      },
    }
  })
}

function replaceArtifact(
  provenanceValue: FrozenProvenance,
  kind: FrozenProvenance['artifacts'][number]['kind'],
  sha256: string,
): FrozenProvenance {
  const artifacts = provenanceValue.artifacts.map((artifact) =>
    artifact.kind === kind ? { ...artifact, sha256 } : artifact,
  )
  return {
    ...provenanceValue,
    artifacts,
    artifactManifestSha256: createHash('sha256')
      .update(stableJson(artifacts))
      .digest('hex'),
  }
}

function mutateState(
  attempt: string,
  mutate: (state: Record<string, any>) => Record<string, any>,
): void {
  const path = join(attempt, 'state.json')
  writeFileSync(path, `${stableJson(mutate(json(path)))}\n`)
}

function json<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}
