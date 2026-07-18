import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import {
  ACTIVE_LIMIT_MS,
  CHECKPOINT_LIMIT_MS,
  REMEDIATION_LIMIT_MS,
  loadPrepared,
  loadState,
  provenanceArtifactKinds,
  prepareAttempt,
  recordMarker,
  recordPassingIsolationAttestation,
  startActiveTime as startActiveTimeWithoutAttestation,
  stableJson,
  superviseActiveLimit,
  superviseCheckpointLimit,
  superviseRemediationLimit,
  type Clock,
} from '../dist/index.js'

describe('active-limit supervisor', () => {
  it('terminates the assigned process group at the active limit', async () => {
    const clock = new TestClock('2026-07-18T00:00:00.000Z')
    const root = mkdtempSync(join(tmpdir(), 'specter-supervisor-'))
    const attempt = prepareAttempt({
      coordinatorRoot: join(root, 'coordinator'),
      adopterRoot: join(root, 'adopter'),
      assignment: assignment(),
      provenance: provenance(),
      clock,
    })
    writeFileSync(
      join(loadPrepared(attempt).adopterDirectory, 'workspace', 'app.txt'),
      'app\n',
    )
    startActiveTime(attempt, clock)
    const signals: Array<[number, NodeJS.Signals]> = []

    const result = await superviseActiveLimit(attempt, 4242, {
      clock,
      pollIntervalMs: 60_000,
      sleep: async (milliseconds) => clock.advance(milliseconds),
      terminate: (pid, signal) => signals.push([pid, signal]),
    })

    assert.equal(result.terminated, true)
    assert.equal(result.activeElapsedMs, ACTIVE_LIMIT_MS)
    assert.deepEqual(signals, [[4242, 'SIGTERM']])
  })

  it('terminates the assigned process group at the checkpoint ceiling', async () => {
    const clock = new TestClock('2026-07-18T00:00:00.000Z')
    const root = mkdtempSync(join(tmpdir(), 'specter-supervisor-checkpoint-'))
    const attempt = prepareAttempt({
      coordinatorRoot: join(root, 'coordinator'),
      adopterRoot: join(root, 'adopter'),
      assignment: assignment(),
      provenance: provenance(),
      clock,
    })
    startActiveTime(attempt, clock)
    recordMarker(attempt, 'bootstrap', 'passed', undefined, clock)
    const signals: Array<[number, NodeJS.Signals]> = []

    const result = await superviseCheckpointLimit(attempt, 4243, {
      clock,
      pollIntervalMs: 60_000,
      sleep: async (milliseconds) => clock.advance(milliseconds),
      terminate: (pid, signal) => signals.push([pid, signal]),
    })

    assert.equal(result.terminated, true)
    assert.equal(result.activeElapsedMs, CHECKPOINT_LIMIT_MS)
    assert.equal(result.checkpointCaptured, true)
    assert.equal(result.paused, true)
    assert.deepEqual(signals, [[4243, 'SIGTERM']])
    const state = loadState(attempt)
    assert.equal(state.timer.runningSince, undefined)
    assert.equal(state.markers.at(-1)?.outcome, 'time-expired')
    assert.equal(state.timer.pauses.at(-1)?.reason, 'checkpoint-capture')
  })

  it('freezes remediation when its independent active ceiling is reached', async () => {
    const clock = new TestClock('2026-07-18T00:00:00.000Z')
    const root = mkdtempSync(join(tmpdir(), 'specter-supervisor-remediation-'))
    const attempt = prepareAttempt({
      coordinatorRoot: join(root, 'coordinator'),
      adopterRoot: join(root, 'adopter'),
      assignment: assignment(),
      provenance: provenance(),
      clock,
    })
    const state = loadState(attempt)
    writeFileSync(
      join(attempt, 'state.json'),
      `${stableJson({
        ...state,
        remediation: {
          startedAt: clock.now().toISOString(),
          timer: {
            limitMs: REMEDIATION_LIMIT_MS,
            accumulatedMs: 0,
            runningSince: clock.now().toISOString(),
            sessions: [],
            pauses: [],
          },
        },
      })}\n`,
    )
    const signals: Array<[number, NodeJS.Signals]> = []

    const result = await superviseRemediationLimit(attempt, 4244, {
      clock,
      pollIntervalMs: 60_000,
      sleep: async (milliseconds) => clock.advance(milliseconds),
      terminate: (pid, signal) => signals.push([pid, signal]),
    })

    assert.equal(result.terminated, true)
    assert.equal(result.activeElapsedMs, REMEDIATION_LIMIT_MS)
    assert.deepEqual(signals, [[4244, 'SIGTERM']])
    const frozen = loadState(attempt)
    assert.ok(frozen.remediation?.snapshot)
    assert.equal(frozen.remediation?.timer.runningSince, undefined)
    assert.equal(
      frozen.remediation?.timer.pauses.at(-1)?.reason,
      'final-freeze',
    )
  })
})

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

function assignment() {
  return {
    attemptId: 'inventory-1',
    domainId: 'inventory',
    domainName: 'Inventory',
    domainKind: 'replication',
    attemptNumber: 1,
    persistence: 'sqlite',
    topology: 'single-process',
    port: 41911,
    workspacePath: 'workspace',
    freezePaths: ['workspace'],
    visibleCommands: [command('visible-check')],
    heldOutCommands: [command('robustness-check')],
  }
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

function provenance() {
  const sha256 = 'a'.repeat(64)
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
      sha256,
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
        sha256,
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
