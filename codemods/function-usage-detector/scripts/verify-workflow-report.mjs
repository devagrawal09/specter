import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const reportPath = resolve(
  'tests/workspace-smoke/.codemod-reports/workflow-test/function-usage-report.json',
)
const report = JSON.parse(readFileSync(reportPath, 'utf8'))

assert.equal(report.schemaVersion, 1)
assert.deepEqual(report.summary, {
  findings: 2,
  files: 1,
  short: 1,
  fewCallSites: 1,
  both: 0,
  byKind: { declaration: 2, variable: 0 },
})

const popular = report.findings.find(
  (finding) => finding.function.name === 'crossFilePopular',
)
assert.ok(popular)
assert.equal(popular.usage.directCallSites, 3)
assert.equal(popular.usage.distinctDirectCallers, 1)
assert.deepEqual(
  popular.usage.callSites.map((call) => `${call.file}:${call.line}`),
  ['callers.ts:3', 'callers.ts:4', 'callers.ts:5'],
)

const rare = report.findings.find(
  (finding) => finding.function.name === 'crossFileRare',
)
assert.ok(rare)
assert.deepEqual(rare.matchedReasons, ['few-call-sites'])
