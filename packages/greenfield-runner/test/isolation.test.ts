import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'

import {
  assertPassingIsolationAttestation,
  parseIsolationContract,
  recordPassingIsolationAttestation,
  rehearseAdopterAccessIsolation,
} from '../dist/index.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('adopter access isolation', () => {
  it('requires physically separate roots and proves public/private canaries', () => {
    const base = temporaryRoot()
    const coordinatorRoot = join(base, 'not-mounted', 'coordinator-private')
    const adopterRoot = join(base, 'adopter-public')
    mkdirSync(adopterRoot)
    const publicCanary = join(adopterRoot, 'public-canary.txt')
    writeFileSync(publicCanary, 'public\n')
    const privateCanary = join(coordinatorRoot, 'not-mounted-private-canary.txt')
    const contract = {
      schemaVersion: 1,
      attemptId: 'inventory-1',
      configSha256: 'a'.repeat(64),
      coordinatorRoot,
      adopterRoot,
      publicCanaryPaths: [publicCanary],
      privateCanaryPaths: [privateCanary],
    }

    const parsed = parseIsolationContract(contract)
    assert.deepEqual(
      rehearseAdopterAccessIsolation(
        contract,
        new Date('2026-07-18T00:00:00.000Z'),
      ),
      {
      ...parsed,
      rehearsedAt: '2026-07-18T00:00:00.000Z',
      passed: true,
      publicReadable: parsed.publicCanaryPaths,
      privateBlocked: parsed.privateCanaryPaths,
      failures: [],
      },
    )
  })

  it('fails if a coordinator-private canary is readable', () => {
    const base = temporaryRoot()
    const coordinatorRoot = join(base, 'coordinator-private')
    const adopterRoot = join(base, 'adopter-public')
    mkdirSync(coordinatorRoot)
    mkdirSync(adopterRoot)
    const publicCanary = join(adopterRoot, 'public-canary.txt')
    const privateCanary = join(coordinatorRoot, 'private-canary.txt')
    writeFileSync(publicCanary, 'public\n')
    writeFileSync(privateCanary, 'private\n')
    const result = rehearseAdopterAccessIsolation({
      schemaVersion: 1,
      attemptId: 'inventory-1',
      configSha256: 'a'.repeat(64),
      coordinatorRoot,
      adopterRoot,
      publicCanaryPaths: [publicCanary],
      privateCanaryPaths: [privateCanary],
    })
    assert.equal(result.passed, false)
    assert.match(result.failures.join('\n'), /private canary is readable/)
  })

  it('binds persisted passing evidence to one exact prepared attempt', () => {
    const base = temporaryRoot()
    const coordinatorRoot = join(base, 'coordinator-private')
    const adopterRoot = join(base, 'adopter-public')
    const attempt = join(coordinatorRoot, 'inventory-1')
    const adopterAttempt = join(adopterRoot, 'inventory-1')
    mkdirSync(attempt, { recursive: true })
    mkdirSync(adopterAttempt, { recursive: true })
    const publicCanary = join(adopterAttempt, 'public.txt')
    const privateCanary = join(attempt, 'private.txt')
    writeFileSync(publicCanary, 'public\n')
    writeFileSync(privateCanary, 'private\n')
    writeFileSync(
      join(attempt, 'frozen-provenance.json'),
      JSON.stringify({
        assignment: { attemptId: 'inventory-1' },
        configSha256: 'a'.repeat(64),
        adopterDirectory: adopterAttempt,
      }),
    )
    const result = {
      schemaVersion: 1,
      attemptId: 'inventory-1',
      configSha256: 'a'.repeat(64),
      coordinatorRoot: attempt,
      adopterRoot: adopterAttempt,
      publicCanaryPaths: [publicCanary],
      privateCanaryPaths: [privateCanary],
      rehearsedAt: '2026-07-18T00:00:00.000Z',
      passed: true,
      publicReadable: [publicCanary],
      privateBlocked: [privateCanary],
      failures: [],
    }

    assert.equal(
      recordPassingIsolationAttestation(attempt, result).attemptId,
      'inventory-1',
    )
    assert.equal(
      assertPassingIsolationAttestation(attempt).configSha256,
      'a'.repeat(64),
    )
    assert.throws(
      () =>
        recordPassingIsolationAttestation(attempt, {
          ...result,
          configSha256: 'b'.repeat(64),
        }),
      /binding mismatch for configSha256/,
    )
  })
})

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'specter-isolation-'))
  roots.push(root)
  return root
}
