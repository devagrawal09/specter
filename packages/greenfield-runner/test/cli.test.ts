import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const cli = join(import.meta.dirname, '..', 'dist', 'cli.js')

describe('greenfield runner CLI', () => {
  it('requires the expected matrix for aggregation', () => {
    const result = run('aggregate', '--attempts-root', import.meta.dirname)

    assert.equal(result.status, 1)
    assert.match(result.stderr, /Missing --matrix/)
  })

  it('validates supervise PIDs before starting the supervisor', () => {
    for (const pid of ['0', '-1', '1.5', '9007199254740992']) {
      const result = run(
        'supervise',
        '--attempt',
        import.meta.dirname,
        '--pid',
        pid,
        '--limit',
        'active',
      )
      assert.equal(result.status, 1)
      assert.match(result.stderr, /--pid must be a positive safe integer/)
    }
  })

  it('requires an active, checkpoint, or remediation supervisor limit', () => {
    const missing = run(
      'supervise',
      '--attempt',
      import.meta.dirname,
      '--pid',
      '42',
    )
    assert.equal(missing.status, 1)
    assert.match(missing.stderr, /Missing --limit/)

    const invalid = run(
      'supervise',
      '--attempt',
      import.meta.dirname,
      '--pid',
      '42',
      '--limit',
      'wall',
    )
    assert.equal(invalid.status, 1)
    assert.match(
      invalid.stderr,
      /--limit must be active, checkpoint, or remediation/,
    )
  })

  it('requires audit evidence for every explicit timer pause', () => {
    const missing = run('timer-stop', '--attempt', import.meta.dirname)
    assert.equal(missing.status, 1)
    assert.match(missing.stderr, /Missing --reason/)

    const invalid = run(
      'timer-stop',
      '--attempt',
      import.meta.dirname,
      '--reason',
      'adopter-wait',
      '--trigger-evidence',
      'agent asked to wait',
      '--coordinator-action',
      'paused timer',
    )
    assert.equal(invalid.status, 1)
    assert.match(invalid.stderr, /--reason must be one of/)
  })

  it('documents separate prepare roots and the supervisor command', () => {
    const result = run('help')

    assert.equal(result.status, 0)
    assert.match(
      result.stdout,
      /prepare --coordinator-root DIR --adopter-root DIR --assignment FILE --provenance FILE/,
    )
    assert.match(result.stdout, /aggregate --attempts-root DIR --matrix FILE/)
    assert.match(
      result.stdout,
      /supervise --attempt DIR --pid PID --limit active\|checkpoint\|remediation/,
    )
  })
})

function run(...args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
  })
}
