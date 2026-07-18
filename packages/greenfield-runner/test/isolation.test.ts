import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'

import {
  parseIsolationContract,
  rehearseAdopterAccessIsolation,
} from '../dist/index.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('adopter access isolation', () => {
  it('requires physically separate roots and proves public/private canaries', () => {
    const base = temporaryRoot()
    const coordinatorRoot = join(base, 'coordinator-private')
    const adopterRoot = join(base, 'adopter-public')
    mkdirSync(coordinatorRoot)
    mkdirSync(adopterRoot)
    const publicCanary = join(adopterRoot, 'public-canary.txt')
    writeFileSync(publicCanary, 'public\n')
    const privateCanary = join(coordinatorRoot, 'not-mounted-private-canary.txt')
    const contract = {
      schemaVersion: 1,
      coordinatorRoot,
      adopterRoot,
      publicCanaryPaths: [publicCanary],
      privateCanaryPaths: [privateCanary],
    }

    const parsed = parseIsolationContract(contract)
    assert.deepEqual(rehearseAdopterAccessIsolation(contract), {
      passed: true,
      publicReadable: parsed.publicCanaryPaths,
      privateBlocked: parsed.privateCanaryPaths,
      failures: [],
    })
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
      coordinatorRoot,
      adopterRoot,
      publicCanaryPaths: [publicCanary],
      privateCanaryPaths: [privateCanary],
    })
    assert.equal(result.passed, false)
    assert.match(result.failures.join('\n'), /private canary is readable/)
  })
})

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'specter-isolation-'))
  roots.push(root)
  return root
}
