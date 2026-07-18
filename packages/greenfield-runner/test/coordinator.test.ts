import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'

import {
  buildFrozenProvenance,
  expandCoordinatorCatalog,
  provenanceArtifactKinds,
  toAdopterAssignment,
  validateCompleteMatrix,
} from '../dist/index.js'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('coordinator catalog', () => {
  it('expands five profiles into a complete deterministic ten-attempt matrix', () => {
    const matrix = expandCoordinatorCatalog(catalog())
    assert.equal(matrix.length, 10)
    assert.deepEqual(
      matrix.map((entry) => entry.attemptId),
      [
        'claims-1',
        'claims-2',
        'cold-chain-1',
        'cold-chain-2',
        'emergency-1',
        'emergency-2',
        'inventory-1',
        'inventory-2',
        'permits-1',
        'permits-2',
      ],
    )
    assert.equal(
      new Set(matrix.map((entry) => entry.domainId)).size,
      5,
    )
    assert.equal(
      new Set(matrix.map((entry) => entry.port)).size,
      5,
    )
    assert.equal(
      matrix.filter(
        (entry) => entry.attemptNumber === 1 && entry.persistence === 'sqlite',
      ).length,
      3,
    )
    assert.deepEqual(matrix[0]?.visibleCommands[0]?.args, [
      'verify-visible.mjs',
      '--attempt',
      'claims-1',
      '--port',
      '41743',
    ])

    const adopter = toAdopterAssignment(matrix[0])
    assert.equal('heldOutCommands' in adopter, false)
    assert.equal(JSON.stringify(adopter).includes('verify-held-out'), false)
  })

  it('rejects incomplete or profile-drifting matrices', () => {
    const matrix = expandCoordinatorCatalog(catalog())
    assert.throws(
      () => validateCompleteMatrix(matrix.slice(0, 9)),
      /exactly ten attempts/,
    )
    assert.throws(
      () =>
        expandCoordinatorCatalog({
          ...catalog(),
          domains: (catalog().domains as object[]).map((domain, index) =>
            index === 4 ? { ...domain, port: 41743 } : domain,
          ),
        }),
      /unique fixed port/,
    )
    assert.throws(
      () =>
        expandCoordinatorCatalog({
          ...catalog(),
          freezePaths: ['logs'],
        }),
      /workspacePath must be included in freezePaths/,
    )
  })
})

describe('provenance builder', () => {
  it('hashes every frozen input and validates expected digests', () => {
    const root = temporaryRoot()
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
    const artifacts = provenanceArtifactKinds.map((kind, index) => ({
      id: `artifact-${index + 1}`,
      audience: publicKinds.has(kind) ? 'public' : 'private',
      kind,
      path: fixture(root, `${kind}.artifact`, `${kind}\n`),
    }))
    const packageArtifact = artifacts.find(
      (artifact) => artifact.kind === 'specterPackage',
    )
    assert.ok(packageArtifact)
    const config = {
      specterCommit: 'abcdef0123456789',
      artifacts,
      packageTarballs: [
        {
          name: '@specter-ts/core',
          version: '0.3.0',
          artifactId: packageArtifact.id,
          path: packageArtifact.path,
        },
      ],
      runtime: runtime(),
    }
    const computed = buildFrozenProvenance(config)
    assert.equal(computed.artifactManifestSha256.length, 64)
    assert.equal(computed.artifacts.length, provenanceArtifactKinds.length)
    assert.equal(computed.packages[0]?.sha256.length, 64)

    const verified = buildFrozenProvenance({
      ...config,
      expected: {
        artifactManifestSha256: computed.artifactManifestSha256,
        artifacts: Object.fromEntries(
          computed.artifacts.map((artifact) => [artifact.id, artifact.sha256]),
        ),
        packageTarballs: {
          '@specter-ts/core': computed.packages[0]?.sha256,
        },
      },
    })
    assert.deepEqual(verified, computed)
    assert.throws(
      () =>
        buildFrozenProvenance({
          ...config,
          expected: { artifactManifestSha256: '0'.repeat(64) },
        }),
      /Digest mismatch for artifactManifestSha256/,
    )
    assert.throws(
      () =>
        buildFrozenProvenance({
          ...config,
          artifacts: artifacts.filter(
            (artifact) => artifact.kind !== 'heldOutSuite',
          ),
        }),
      /must include at least one heldOutSuite artifact/,
    )
  })
})

function catalog(): Record<string, unknown> {
  return {
    domains: [
      domain('emergency', 'Emergency Department', 'replication', 'sqlite', 41741),
      domain('cold-chain', 'Cold Chain', 'replication', 'postgres', 41742),
      domain('claims', 'Claims', 'replication', 'sqlite', 41743),
      domain('inventory', 'Inventory', 'transfer', 'postgres', 41744),
      domain('permits', 'Permits', 'transfer', 'sqlite', 41745),
    ],
    workspacePath: 'workspace',
    freezePaths: ['workspace', 'logs'],
    visibleCommands: [
      {
        id: 'visible-{attemptNumber}',
        file: 'node',
        args: [
          'verify-visible.mjs',
          '--attempt',
          '{attemptId}',
          '--port',
          '{port}',
        ],
        cwd: '{workspacePath}',
        timeoutMs: 60_000,
      },
    ],
    heldOutCommands: [
      {
        id: 'held-{attemptNumber}',
        file: 'node',
        args: ['verify-held-out.mjs', '--domain', '{domainId}'],
        cwd: '{workspacePath}',
        timeoutMs: 60_000,
      },
    ],
  }
}

function domain(
  domainId: string,
  domainName: string,
  domainKind: string,
  persistence: string,
  port: number,
): object {
  return { domainId, domainName, domainKind, persistence, port }
}

function temporaryRoot(): string {
  const directory = mkdtempSync(join(tmpdir(), 'specter-coordinator-'))
  temporaryDirectories.push(directory)
  return directory
}

function fixture(root: string, name: string, content: string): string {
  const path = join(root, name)
  writeFileSync(path, content)
  return path
}

function runtime(): object {
  return {
    model: {
      provider: 'openai',
      id: 'test-model',
      build: '2026-07-18',
      reasoningSetting: 'test',
      sampler: { seed: 42, temperature: 0 },
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
      browserRevision: 'test-revision',
    },
    services: [{ id: 'postgres', version: 'test', digest: 'sha256:test' }],
    runOrderSeed: 'greenfield-test-order',
  }
}
