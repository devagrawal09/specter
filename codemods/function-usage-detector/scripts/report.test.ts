import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildReport,
  renderHtmlReport,
  renderJsonReport,
  type FunctionUsageFinding,
} from './report.ts'
import { reportDirectory } from './report-path.ts'

const finding: FunctionUsageFinding = {
  id: 'src/math.ts:4:17:double',
  function: { name: 'double', kind: 'variable' },
  location: {
    file: 'src/math.ts',
    line: 4,
    column: 17,
    endLine: 4,
    endColumn: 23,
  },
  body: { codeLines: 1 },
  usage: {
    directCallSites: 1,
    distinctDirectCallers: 1,
    resolvedReferences: 2,
    nonCallReferences: 1,
    callSites: [
      {
        file: 'src/index.ts',
        line: 8,
        column: 3,
        caller: { kind: 'function', name: 'main', line: 6 },
      },
    ],
  },
  matchedReasons: ['short', 'few-call-sites'],
}

test('builds a deterministic detailed report', () => {
  const report = buildReport({
    findings: [finding],
    generatedAt: '2026-07-18T12:00:00.000Z',
    minimumCallSites: 3,
    minimumLines: 3,
    target: '.',
  })

  assert.deepEqual(report.summary, {
    findings: 1,
    files: 1,
    short: 1,
    fewCallSites: 1,
    both: 1,
    byKind: { declaration: 0, variable: 1 },
  })
  assert.equal(JSON.parse(renderJsonReport(report)).findings[0].id, finding.id)
})

test('renders a self-contained HTML report and escapes embedded data', () => {
  const report = buildReport({
    findings: [
      {
        ...finding,
        function: { ...finding.function, name: '</script><b>unsafe</b>' },
      },
    ],
    generatedAt: '2026-07-18T12:00:00.000Z',
    minimumCallSites: 3,
    minimumLines: 3,
    target: '<repo>',
  })
  const html = renderHtmlReport(report)

  assert.match(html, /<!doctype html>/)
  assert.match(html, /id="report-data"/)
  assert.match(html, /Search function or file/)
  assert.doesNotMatch(html, /<\/script><b>unsafe<\/b>/)
  assert.match(html, /\\u003c\/script>\\u003cb>unsafe\\u003c\/b>/)
})

test('keeps report output inside the target directory', () => {
  assert.equal(
    reportDirectory('/workspace/project', '.reports/functions'),
    '/workspace/project/.reports/functions',
  )
  assert.throws(
    () => reportDirectory('/workspace/project', '../outside'),
    /must stay inside/,
  )
  assert.throws(
    () => reportDirectory('/workspace/project', '/tmp/outside'),
    /must be relative/,
  )
})
