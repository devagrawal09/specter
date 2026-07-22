import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'

import {
  generateSlice,
  runGenerateCli,
} from '../src/generate.ts'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function projectDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'create-specter-generator-'))
  temporaryDirectories.push(directory)
  return directory
}

describe('Slice generator', () => {
  it('creates a vertical SQLite Query Slice bundle', () => {
    const cwd = projectDirectory()
    const result = generateSlice({
      cwd,
      feature: 'invitations',
      kind: 'query',
      name: 'invitationList',
    })

    assert.equal(result.files.length, 8)
    const base = join(
      cwd,
      'src/features/invitations/invitation-list',
    )
    assert.match(
      readFileSync(join(base, 'spec.ts'), 'utf8'),
      /export const invitationListSpec = _createQuerySlice\('invitationList'\)/,
    )
    assert.match(
      readFileSync(join(base, 'spec.ts'), 'utf8'),
      /export default invitationListSpec/,
    )
    assert.match(
      readFileSync(join(base, 'impl.ts'), 'utf8'),
      /export const invitationList = _implementQuery\(_specification\)/,
    )
    assert.match(
      readFileSync(join(base, 'impl.ts'), 'utf8'),
      /from '\.\/spec\.json'/,
    )
    assert.match(
      readFileSync(join(base, 'scenarios.test.ts'), 'utf8'),
      /const registrations = invitationListRegistrations/,
    )
    assert.match(
      readFileSync(join(base, 'scenarios.test.ts'), 'utf8'),
      /eventsFor\(registrations\[0\], invitationListEventDefinitions\)/,
    )
    assert.match(
      readFileSync(join(base, 'MIGRATION.md'), 'utf8'),
      /npm run db:generate/,
    )
  })

  it('supports dry-runs without touching the filesystem', () => {
    const cwd = projectDirectory()
    const result = generateSlice({
      cwd,
      dryRun: true,
      feature: 'invitations',
      kind: 'command',
      name: 'requestInvite',
    })

    assert.equal(result.dryRun, true)
    assert.equal(existsSync(join(cwd, 'src')), false)
  })

  it('covers generated Command apply handlers with a Given Event', () => {
    const cwd = projectDirectory()
    generateSlice({
      cwd,
      feature: 'invitations',
      kind: 'command',
      name: 'requestInvite',
    })

    const base = join(cwd, 'src/features/invitations/request-invite')
    assert.match(
      readFileSync(join(base, 'spec.ts'), 'utf8'),
      /requestId: 'request-0'/,
    )
    assert.match(
      readFileSync(join(base, 'impl.ts'), 'utf8'),
      /\.apply\(_recordedEvent/,
    )
  })

  it('creates a Reaction with default same-app Command dispatch', () => {
    const cwd = projectDirectory()
    generateSlice({
      cwd,
      feature: 'invitations',
      kind: 'reaction',
      name: 'sendInvitation',
    })

    const implementation = readFileSync(
      join(cwd, 'src/features/invitations/send-invitation/impl.ts'),
      'utf8',
    )
    assert.doesNotMatch(implementation, /\.plugin\(/)
    assert.match(implementation, /_implementReaction\(_specification\)/)
    assert.match(implementation, /\.handle\(async \(db\)/)
  })

  it('computes database imports for a custom Slice root', () => {
    const cwd = projectDirectory()
    const result = generateSlice({
      cwd,
      feature: 'invitations',
      kind: 'query',
      name: 'invitationList',
      rootDirectory: 'src/domain/slices',
    })

    const implementation = readFileSync(
      join(
        cwd,
        'src/domain/slices/invitations/invitation-list/impl.ts',
      ),
      'utf8',
    )
    assert.match(
      implementation,
      /from '\.\.\/\.\.\/\.\.\/\.\.\/db\/specter-sqlite'/,
    )
    assert.match(
      result.nextSteps.join('\n'),
      /from '\.\.\/domain\/slices\/invitations\/invitation-list\/db-schema'/,
    )
  })

  it('refuses invalid names, traversal, and accidental overwrites', () => {
    const cwd = projectDirectory()
    assert.throws(
      () =>
        generateSlice({
          cwd,
          feature: 'invitations',
          kind: 'command',
          name: '__proto__',
        }),
      /lower camel case/,
    )
    assert.throws(
      () =>
        generateSlice({
          cwd,
          feature: 'invitations',
          kind: 'command',
          name: 'requestInvite',
          rootDirectory: '../outside',
        }),
      /cannot traverse/,
    )

    generateSlice({
      cwd,
      feature: 'invitations',
      kind: 'command',
      name: 'requestInvite',
    })
    assert.throws(
      () =>
        generateSlice({
          cwd,
          feature: 'invitations',
          kind: 'command',
          name: 'requestInvite',
        }),
      /Refusing to overwrite/,
    )
  })

  it('parses the public CLI command and reports generated files', () => {
    const cwd = projectDirectory()
    const output: string[] = []
    assert.equal(
      runGenerateCli(
        [
          'generate',
          'slice',
          'sendInvite',
          '--kind',
          'reaction',
          '--feature',
          'invitations',
          '--dry-run',
        ],
        { cwd, write: (message) => output.push(message) },
      ),
      true,
    )
    assert.match(output.join('\n'), /Would generate:/)
    assert.match(output.join('\n'), /send-invite\/spec.ts/)
  })

  it('prints generator help without writing files', () => {
    const cwd = projectDirectory()
    const output: string[] = []
    assert.equal(
      runGenerateCli(['generate', '--help'], {
        cwd,
        write: (message) => output.push(message),
      }),
      true,
    )
    assert.match(output.join('\n'), /generate slice/)
    assert.equal(existsSync(join(cwd, 'src')), false)
  })
})
