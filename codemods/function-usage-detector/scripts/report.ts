export const REPORT_SCHEMA_VERSION = 1
export const REPORT_STATE_KEY = 'function-usage-report-findings'

export type FunctionKind = 'declaration' | 'variable'
export type MatchReason = 'short' | 'few-call-sites'

export type SourceLocation = {
  file: string
  line: number
  column: number
}

export type DirectCallSite = SourceLocation & {
  caller: {
    kind: 'function' | 'top-level'
    name: string
    line: number | null
  }
}

export type FunctionUsageFinding = {
  id: string
  function: {
    name: string
    kind: FunctionKind
  }
  location: SourceLocation & {
    endLine: number
    endColumn: number
  }
  body: {
    codeLines: number
  }
  usage: {
    directCallSites: number
    distinctDirectCallers: number
    resolvedReferences: number
    nonCallReferences: number
    callSites: DirectCallSite[]
  }
  matchedReasons: MatchReason[]
}

export type FunctionUsageReport = {
  schemaVersion: typeof REPORT_SCHEMA_VERSION
  generatedAt: string
  target: string
  detector: {
    functionShapes: ['function-declaration', 'identifier-bound-function']
    usageMetric: 'resolved-direct-call-sites'
    limitations: string[]
  }
  thresholds: {
    minimumCodeLines: number
    minimumDirectCallSites: number
  }
  summary: {
    findings: number
    files: number
    short: number
    fewCallSites: number
    both: number
    byKind: Record<FunctionKind, number>
  }
  findings: FunctionUsageFinding[]
}

export function buildReport(input: {
  findings: FunctionUsageFinding[]
  generatedAt?: string
  minimumCallSites: number
  minimumLines: number
  target: string
}): FunctionUsageReport {
  const findings = [...input.findings].sort(compareFindings)
  let short = 0
  let fewCallSites = 0
  let both = 0
  const byKind: Record<FunctionKind, number> = {
    declaration: 0,
    variable: 0,
  }

  for (const finding of findings) {
    const isShort = finding.matchedReasons.includes('short')
    const hasFewCallSites = finding.matchedReasons.includes('few-call-sites')
    if (isShort) short += 1
    if (hasFewCallSites) fewCallSites += 1
    if (isShort && hasFewCallSites) both += 1
    byKind[finding.function.kind] += 1
  }

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    target: input.target,
    detector: {
      functionShapes: ['function-declaration', 'identifier-bound-function'],
      usageMetric: 'resolved-direct-call-sites',
      limitations: [
        'Only named function declarations and identifier-bound arrow or function expressions are analyzed.',
        'Usage counts only semantically resolved direct calls; JSX, callbacks, registrations, aliases, and unresolved package references are not direct call sites.',
        'The threshold applies to call sites, not unique callers. Distinct direct callers are included as supporting evidence.',
      ],
    },
    thresholds: {
      minimumCodeLines: input.minimumLines,
      minimumDirectCallSites: input.minimumCallSites,
    },
    summary: {
      findings: findings.length,
      files: new Set(findings.map((finding) => finding.location.file)).size,
      short,
      fewCallSites,
      both,
      byKind,
    },
    findings,
  }
}

export function renderJsonReport(report: FunctionUsageReport) {
  return `${JSON.stringify(report, null, 2)}\n`
}

export function renderHtmlReport(report: FunctionUsageReport) {
  const embeddedReport = JSON.stringify(report)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Function usage report</title>
  <style>
    :root { color-scheme: light dark; --bg:#f5f7fb; --panel:#fff; --ink:#172033; --muted:#647087; --line:#dce2ec; --accent:#5b4bdb; --accent-soft:#eeebff; --warn:#a2490b; --warn-soft:#fff0df; --shadow:0 12px 36px rgba(31,42,68,.08); }
    @media (prefers-color-scheme: dark) { :root { --bg:#111521; --panel:#191f2d; --ink:#edf1fa; --muted:#aab4c8; --line:#30394b; --accent:#a99cff; --accent-soft:#292440; --warn:#ffb26f; --warn-soft:#3b291f; --shadow:none; } }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    main { width:min(1440px,calc(100% - 32px)); margin:0 auto; padding:48px 0 72px; }
    h1 { margin:0; font-size:clamp(28px,4vw,44px); letter-spacing:-.035em; }
    h2 { margin:0; font-size:18px; }
    p { margin:0; }
    code { font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; }
    .eyebrow { color:var(--accent); font-size:12px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; }
    .subhead { max-width:900px; margin-top:10px; color:var(--muted); }
    .meta { display:flex; flex-wrap:wrap; gap:8px 20px; margin-top:18px; color:var(--muted); font-size:12px; }
    .cards { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:12px; margin:28px 0; }
    .card,.panel { border:1px solid var(--line); border-radius:14px; background:var(--panel); box-shadow:var(--shadow); }
    .card { padding:18px; }
    .card span { display:block; color:var(--muted); font-size:12px; font-weight:700; text-transform:uppercase; }
    .card strong { display:block; margin-top:4px; font-size:28px; letter-spacing:-.03em; }
    .notice { margin-bottom:18px; padding:14px 16px; border:1px solid color-mix(in srgb,var(--warn) 30%,var(--line)); border-radius:12px; background:var(--warn-soft); color:var(--warn); }
    .notice summary { cursor:pointer; font-weight:800; }
    .notice ul { margin:10px 0 0; padding-left:20px; }
    .toolbar { display:grid; grid-template-columns:minmax(220px,1fr) repeat(2,minmax(150px,220px)); gap:10px; padding:14px; border-bottom:1px solid var(--line); }
    input,select { width:100%; min-height:40px; border:1px solid var(--line); border-radius:9px; padding:8px 11px; background:var(--bg); color:var(--ink); font:inherit; }
    .result-count { padding:12px 16px; color:var(--muted); font-size:12px; border-bottom:1px solid var(--line); }
    .table-wrap { overflow:auto; }
    table { width:100%; border-collapse:collapse; }
    th,td { padding:12px 14px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; }
    th { position:sticky; top:0; z-index:1; background:var(--panel); color:var(--muted); font-size:11px; letter-spacing:.06em; text-transform:uppercase; white-space:nowrap; }
    tbody tr:hover { background:color-mix(in srgb,var(--accent-soft) 50%,transparent); }
    tbody tr:last-child td { border-bottom:0; }
    .fn { font-weight:800; }
    .path { color:var(--muted); overflow-wrap:anywhere; }
    .number { font-variant-numeric:tabular-nums; }
    .bad { color:var(--warn); font-weight:800; }
    .badge { display:inline-flex; margin:1px 5px 1px 0; padding:2px 7px; border-radius:999px; background:var(--accent-soft); color:var(--accent); font-size:11px; font-weight:800; white-space:nowrap; }
    details.calls summary { cursor:pointer; color:var(--accent); white-space:nowrap; }
    .calls ul { min-width:300px; margin:8px 0 0; padding-left:18px; }
    .calls li { margin:4px 0; }
    .empty { padding:48px 20px; text-align:center; color:var(--muted); }
    footer { margin-top:14px; color:var(--muted); font-size:12px; }
    @media (max-width:900px) { .cards { grid-template-columns:repeat(2,minmax(0,1fr)); } .toolbar { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <main>
    <header>
      <p class="eyebrow">Static analysis</p>
      <h1>Function usage report</h1>
      <p class="subhead">Named functions with fewer than ${report.thresholds.minimumCodeLines} code lines or fewer than ${report.thresholds.minimumDirectCallSites} resolved direct call sites.</p>
      <div class="meta"><span>Target: <code>${escapeHtml(report.target)}</code></span><span>Generated: ${escapeHtml(report.generatedAt)}</span><span>Schema v${report.schemaVersion}</span></div>
    </header>
    <section class="cards" aria-label="Summary">
      <div class="card"><span>Findings</span><strong>${report.summary.findings}</strong></div>
      <div class="card"><span>Files</span><strong>${report.summary.files}</strong></div>
      <div class="card"><span>Short</span><strong>${report.summary.short}</strong></div>
      <div class="card"><span>Few call sites</span><strong>${report.summary.fewCallSites}</strong></div>
      <div class="card"><span>Both signals</span><strong>${report.summary.both}</strong></div>
    </section>
    <details class="notice">
      <summary>Read the usage counts carefully</summary>
      <ul>${report.detector.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    </details>
    <section class="panel">
      <div class="toolbar">
        <input id="search" type="search" placeholder="Search function or file…" aria-label="Search findings">
        <select id="reason" aria-label="Filter by reason"><option value="all">All reasons</option><option value="short">Short</option><option value="few-call-sites">Few call sites</option><option value="both">Both</option></select>
        <select id="sort" aria-label="Sort findings"><option value="file">File and line</option><option value="calls-asc">Fewest call sites</option><option value="lines-asc">Shortest first</option><option value="name">Function name</option></select>
      </div>
      <div id="result-count" class="result-count"></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Function</th><th>Location</th><th>Code lines</th><th>Direct calls</th><th>Distinct callers</th><th>Reason</th><th>Evidence</th></tr></thead>
          <tbody id="rows"></tbody>
        </table>
        <div id="empty" class="empty" hidden>No findings match these filters.</div>
      </div>
    </section>
    <footer>The JSON file is the canonical machine-readable artifact. This HTML file is self-contained and reads the same embedded data.</footer>
  </main>
  <script id="report-data" type="application/json">${embeddedReport}</script>
  <script>
    const report = JSON.parse(document.getElementById('report-data').textContent)
    const rows = document.getElementById('rows')
    const empty = document.getElementById('empty')
    const resultCount = document.getElementById('result-count')
    const search = document.getElementById('search')
    const reason = document.getElementById('reason')
    const sort = document.getElementById('sort')
    const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]))
    const reasonMatches = (finding, filter) => filter === 'all' || (filter === 'both' ? finding.matchedReasons.length === 2 : finding.matchedReasons.includes(filter))
    const render = () => {
      const query = search.value.trim().toLowerCase()
      const filtered = report.findings.filter((finding) => reasonMatches(finding, reason.value) && (!query || (finding.function.name + ' ' + finding.location.file).toLowerCase().includes(query)))
      filtered.sort((a,b) => sort.value === 'calls-asc' ? a.usage.directCallSites - b.usage.directCallSites || a.location.file.localeCompare(b.location.file) : sort.value === 'lines-asc' ? a.body.codeLines - b.body.codeLines || a.location.file.localeCompare(b.location.file) : sort.value === 'name' ? a.function.name.localeCompare(b.function.name) : a.location.file.localeCompare(b.location.file) || a.location.line - b.location.line)
      rows.innerHTML = filtered.map((finding) => {
        const calls = finding.usage.callSites.map((call) => '<li><code>' + esc(call.file) + ':' + call.line + ':' + call.column + '</code> — ' + esc(call.caller.name) + '</li>').join('')
        const evidence = calls ? '<details class="calls"><summary>' + finding.usage.directCallSites + ' call site' + (finding.usage.directCallSites === 1 ? '' : 's') + '</summary><ul>' + calls + '</ul></details>' : '<span class="path">No resolved direct calls</span>'
        return '<tr><td><span class="fn">' + esc(finding.function.name) + '</span><br><span class="path">' + esc(finding.function.kind) + '</span></td><td><code>' + esc(finding.location.file) + ':' + finding.location.line + ':' + finding.location.column + '</code></td><td class="number ' + (finding.matchedReasons.includes('short') ? 'bad' : '') + '">' + finding.body.codeLines + '</td><td class="number ' + (finding.matchedReasons.includes('few-call-sites') ? 'bad' : '') + '">' + finding.usage.directCallSites + '</td><td class="number">' + finding.usage.distinctDirectCallers + '</td><td>' + finding.matchedReasons.map((item) => '<span class="badge">' + esc(item) + '</span>').join('') + '</td><td>' + evidence + '</td></tr>'
      }).join('')
      resultCount.textContent = filtered.length + ' of ' + report.findings.length + ' findings'
      empty.hidden = filtered.length !== 0
    }
    search.addEventListener('input', render)
    reason.addEventListener('change', render)
    sort.addEventListener('change', render)
    render()
  </script>
</body>
</html>
`
}

function compareFindings(left: FunctionUsageFinding, right: FunctionUsageFinding) {
  return (
    left.location.file.localeCompare(right.location.file) ||
    left.location.line - right.location.line ||
    left.location.column - right.location.column ||
    left.function.name.localeCompare(right.function.name)
  )
}

function escapeHtml(value: string | number) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    }
    return entities[character] ?? character
  })
}
