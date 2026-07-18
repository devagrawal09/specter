import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import {
  ACTIVE_LIMIT_MS,
  prepareAttempt,
  startActiveTime,
  superviseActiveLimit,
  type Clock,
} from '../dist/index.js'

describe('active-limit supervisor', () => {
  it('terminates the assigned process group at the active limit', async () => {
    const clock = new TestClock('2026-07-18T00:00:00.000Z')
    const root = mkdtempSync(join(tmpdir(), 'specter-supervisor-'))
    const attempt = prepareAttempt({
      attemptsRoot: root,
      assignment: assignment(),
      provenance: provenance(),
      clock,
    })
    writeFileSync(join(attempt, 'workspace', 'app.txt'), 'app\n')
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
  const digest = 'a'.repeat(64)
  return {
    specterCommit: 'abc1234',
    promptSha256: digest,
    guidanceSha256: digest,
    guidanceFiles: [{ id: 'skill', sha256: digest }],
    briefSha256: digest,
    semanticCatalogSha256: digest,
    verifierSha256: digest,
    packages: [{ name: '@specter-ts/core', version: '0.3.0', sha256: digest }],
    model: 'test-model',
    reasoningSetting: 'high',
  }
}
