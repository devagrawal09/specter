import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const featureRoot = resolve(root, 'src/features/reactivity')

const paths = {
  createReactiveComputation:
    'create-reactive-computation/spec.json',
  createReactiveEffect: 'create-reactive-effect/spec.json',
  createReactiveSignal: 'create-reactive-signal/spec.json',
  disposeReactiveGraph: 'dispose-reactive-graph/spec.json',
  reactiveNodeValue: 'reactive-node-value/spec.json',
  settleReactiveBatch: 'settle-reactive-batch/spec.json',
  writeReactiveSignal: 'write-reactive-signal/spec.json',
}

const specs = Object.fromEntries(
  await Promise.all(
    Object.entries(paths).map(async ([name, path]) => [
      name,
      JSON.parse(await readFile(resolve(featureRoot, path), 'utf8')),
    ]),
  ),
)

for (const [name, specification] of Object.entries(specs)) {
  assert.equal(specification.name, name)
  assert.ok(specification.scenarios.length > 0)
}

for (const name of [
  'createReactiveComputation',
  'createReactiveEffect',
  'createReactiveSignal',
  'writeReactiveSignal',
]) {
  const scenarios = specs[name].scenarios
  assert.ok(
    scenarios.some(
      (scenario) =>
        scenario.given.some(
          (given) => given.eventType === 'reactive-batch-settled',
        ) &&
        scenario.reject?.reason.includes('already settled'),
    ),
    `${name} must reject mutation in a settled batch`,
  )
}

const settlementDescriptions = new Set(
  specs.settleReactiveBatch.scenarios.map((scenario) => scenario.description),
)
for (const description of [
  'Reevaluates from the newly selected dynamic dependency.',
  'Executes a multi-input effect once when both dependencies change.',
  'Treats a fresh equal-shaped computation result as changed identity.',
  'Rejects settlement when a registered callback throws.',
  'Rejects settlement of a batch other than the open batch.',
  'Rejects a batch with no pending creation or write.',
]) {
  assert.ok(
    settlementDescriptions.has(description),
    `settlement contract is missing: ${description}`,
  )
}

const queryStatuses = new Set(
  specs.reactiveNodeValue.scenarios.map((scenario) => scenario.expect.status),
)
assert.deepEqual(
  queryStatuses,
  new Set([
    'available',
    'batch-open',
    'graph-disposed',
    'graph-not-found',
    'not-found',
    'not-readable',
  ]),
)

assert.ok(
  specs.reactiveNodeValue.scenarios.some(
    (scenario) =>
      scenario.description ===
      'Keeps another graph available when identifiers are reused.',
  ),
)

const callbackIds = new Set()
for (const specification of Object.values(specs)) {
  collectCallbackIds(specification.scenarios, callbackIds)
}
const callbackDocumentation = await readFile(
  resolve(root, 'CALLBACKS.md'),
  'utf8',
)
for (const callbackId of callbackIds) {
  assert.ok(
    callbackDocumentation.includes(`\`${callbackId}\``),
    `CALLBACKS.md must define ${callbackId}`,
  )
}

const upstream = JSON.parse(
  await readFile(resolve(root, 'upstream.json'), 'utf8'),
)
assert.equal(
  upstream.repository,
  'https://github.com/milomg/js-reactivity-benchmark.git',
)
assert.match(upstream.commit, /^[a-f0-9]{40}$/)

console.log('Reactivity benchmark contract verified.')

function collectCallbackIds(value, result) {
  if (Array.isArray(value)) {
    for (const item of value) collectCallbackIds(item, result)
    return
  }
  if (!value || typeof value !== 'object') return
  if (typeof value.callbackId === 'string') result.add(value.callbackId)
  for (const item of Object.values(value)) collectCallbackIds(item, result)
}
