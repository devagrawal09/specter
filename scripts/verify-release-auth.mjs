import { spawnSync } from 'node:child_process'

const releasePackages = [
  '@specter-ts/core',
  '@specter-ts/memory',
  '@specter-ts/sqlite',
  '@specter-ts/postgres',
  '@specter-ts/reaction-outbox',
  '@specter-ts/observability',
  'create-specter',
]

const whoami = runNpm(['whoami'])
if (whoami.status !== 0) fail('npm authentication failed', whoami)

const username = whoami.stdout.trim()
if (!username) throw new Error('npm whoami returned an empty username')

const existingPackages = []
const firstPublishPackages = []

for (const packageName of releasePackages) {
  const owners = runNpm(['owner', 'ls', packageName])
  if (owners.status === 0) {
    const ownerNames = owners.stdout
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/, 1)[0])
      .filter(Boolean)

    if (!ownerNames.includes(username)) {
      throw new Error(
        `${username} is authenticated but is not an owner of ${packageName}`,
      )
    }
    existingPackages.push(packageName)
    continue
  }

  if (isUnpublished(owners)) {
    firstPublishPackages.push(packageName)
    continue
  }

  fail(`could not inspect npm ownership for ${packageName}`, owners)
}

console.log(`npm release identity: ${username}`)
console.log(`existing package ownership verified: ${existingPackages.join(', ')}`)
if (firstPublishPackages.length > 0) {
  console.log(
    [
      'unpublished package names (npm has no owner metadata yet):',
      firstPublishPackages.join(', '),
      'the publisher must have first-publish access to the @specter-ts scope;',
      'after publication this verifier will require explicit package ownership.',
    ].join(' '),
  )
}

function runNpm(args) {
  return spawnSync('npm', args, {
    encoding: 'utf8',
    env: process.env,
  })
}

function isUnpublished(result) {
  const output = `${result.stdout}\n${result.stderr}`
  return (
    /\bE404\b/i.test(output) ||
    /404 Not Found/i.test(output) ||
    /is not in this registry/i.test(output)
  )
}

function fail(message, result) {
  const detail = (result.stderr || result.stdout).trim()
  throw new Error(detail ? `${message}: ${detail}` : message)
}
