import { createMemo, createSignal, onMount } from 'solid-js'
import html from 'solid-js/html'
import { render } from 'solid-js/web'
import type {
  CollectedRuntimeObservation,
  RuntimeOverview,
  RuntimeTrace,
} from './collector-model'
import type { CollectedSpecification } from './specification-catalog'

const base =
  document.querySelector<HTMLMetaElement>('meta[name="specter-base"]')
    ?.content ?? ''
const [specifications, setSpecifications] = createSignal<
  readonly CollectedSpecification[]
>([])
const [overview, setOverview] = createSignal<RuntimeOverview>()
const [activity, setActivity] = createSignal<
  readonly CollectedRuntimeObservation[]
>([])
const [selectedDigest, setSelectedDigest] = createSignal('')
const [selectedScenario, setSelectedScenario] = createSignal(0)
const [search, setSearch] = createSignal('')
const [trace, setTrace] = createSignal<RuntimeTrace>()

async function refresh() {
  const [specs, summary, recent] = await Promise.all([
    fetch(`${base}/v1/specifications`).then(
      (response) => response.json() as Promise<CollectedSpecification[]>,
    ),
    fetch(`${base}/v1/overview`).then(
      (response) => response.json() as Promise<RuntimeOverview>,
    ),
    fetch(`${base}/v1/activity?limit=200`).then(
      (response) => response.json() as Promise<CollectedRuntimeObservation[]>,
    ),
  ])
  setSpecifications(specs)
  setOverview(summary)
  setActivity(recent)
  if (!selectedDigest() && specs[0]) setSelectedDigest(specs[0].digest)
}

const selected = createMemo(() =>
  specifications().find((item) => item.digest === selectedDigest()),
)
const visible = createMemo(() => {
  const query = search().trim().toLowerCase()
  return specifications().filter(
    (item) =>
      !query ||
      item.document.name.toLowerCase().includes(query) ||
      item.sources.some((source) =>
        source.application.toLowerCase().includes(query),
      ),
  )
})
const correlated = createMemo(() => {
  const current = selected()
  if (!current) return activity()
  const applications = new Set(
    current.sources.map((source) => source.application),
  )
  return activity().filter(
    (item) =>
      item.specificationDigest === current.digest &&
      applications.has(item.source.application),
  )
})

function json(value: unknown) {
  return JSON.stringify(value, null, 2)
}
function scenarioThen(
  current: CollectedSpecification['document'],
  scenario: (typeof current.scenarios)[number],
) {
  if (current.kind === 'command' && 'reject' in scenario && scenario.reject)
    return { status: 'rejected', value: scenario.reject }
  return { status: 'accepted', value: scenario.expect }
}

async function showTrace(entry: CollectedRuntimeObservation) {
  const parameters = new URLSearchParams({
    application: entry.source.application,
    environment: entry.source.environment,
    instanceId: entry.source.instanceId,
    eventLogId: entry.source.eventLogId,
  })
  setTrace(
    await fetch(
      `${base}/v1/traces/${encodeURIComponent(entry.operationId)}?${parameters}`,
    ).then((response) => response.json() as Promise<RuntimeTrace>),
  )
}

function SliceMap(props: { specification: CollectedSpecification }) {
  const doc = () => props.specification.document
  const totalGiven = () =>
    doc().scenarios.reduce(
      (count, scenario) => count + scenario.given.length,
      0,
    )
  return html`<svg class="map" viewBox="0 0 780 190" role="img" aria-label="Whole Slice Given When Then map">
    <defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#98a2b3"/></marker></defs>
    <path d="M230 95 H295 M485 95 H550" stroke="#98a2b3" stroke-width="2" marker-end="url(#arrow)"/>
    <g><rect x="25" y="40" width="205" height="110" rx="14" fill="#eef4ff" stroke="#b2ccff"/><text x="45" y="72" font-size="13" font-weight="700" fill="#1849a9">GIVEN</text><text x="45" y="104" font-size="24" font-weight="700" fill="#18202d">${totalGiven}</text><text x="45" y="126" font-size="12" fill="#667085">event examples across ${doc().scenarios.length} lanes</text></g>
    <g><rect x="295" y="40" width="190" height="110" rx="14" fill="#f4f3ff" stroke="#c7c0ff"/><text x="315" y="72" font-size="13" font-weight="700" fill="#4235a8">WHEN</text><text x="315" y="104" font-size="19" font-weight="700" fill="#18202d">${doc().kind}</text><text x="315" y="126" font-size="12" fill="#667085">${doc().name}</text></g>
    <g><rect x="550" y="40" width="205" height="110" rx="14" fill="#ecfdf3" stroke="#a6f4c5"/><text x="570" y="72" font-size="13" font-weight="700" fill="#067647">THEN</text><text x="570" y="104" font-size="24" font-weight="700" fill="#18202d">${doc().scenarios.length}</text><text x="570" y="126" font-size="12" fill="#667085">specified outcomes</text></g>
  </svg>`
}

function App() {
  onMount(() => {
    void refresh()
    const stream = new EventSource(`${base}/v1/stream`)
    stream.addEventListener('activity', (event) => {
      const item = JSON.parse(
        (event as MessageEvent).data,
      ) as CollectedRuntimeObservation
      setActivity((items) =>
        [
          ...items.filter(
            (candidate) => candidate.observationId !== item.observationId,
          ),
          item,
        ].slice(-200),
      )
      void refresh()
    })
  })

  return html`<div class="shell">
    <aside class="rail"><div class="brand"><span class="mark"></span><strong>Specter</strong></div>
      <input aria-label="Search applications and Slices" placeholder="Search apps or Slices" value=${search} onInput=${(event: InputEvent) => setSearch((event.currentTarget as HTMLInputElement).value)} />
      <h2>Specifications</h2>
      ${() =>
        visible().map(
          (item) =>
            html`<button class="slice-button" aria-current=${selectedDigest() === item.digest} onClick=${() => {
              setSelectedDigest(item.digest)
              setSelectedScenario(0)
            }}><strong>${item.document.name}</strong><small>${item.sources[0]?.application ?? 'unassociated'} · ${item.document.kind}</small></button>`,
        )}
    </aside>
    <main class="content">${() => {
      const item = selected()
      if (!item)
        return html`<section class="panel empty"><h1>No specifications published</h1><p>Start an opted-in Specter runtime to publish its generated spec.json documents.</p></section>`
      const doc = item.document
      const lane = doc.scenarios[selectedScenario()] ?? doc.scenarios[0]
      if (!lane) return null
      const then = scenarioThen(doc, lane)
      return html`<header class="topbar"><div><div class="eyebrow">${doc.kind} Slice · format v${doc.formatVersion}</div><h1>${doc.name}</h1><p class="muted">${doc.description}</p><div class="digest">${item.digest}</div></div><span class=${`status ${then.status}`}>${then.status}</span></header>
      <section class="stats"><div class="stat"><span class="muted">Scenarios</span><strong>${doc.scenarios.length}</strong></div><div class="stat"><span class="muted">Executions</span><strong>${correlated().length}</strong></div><div class="stat"><span class="muted">Failures</span><strong>${correlated().filter((entry) => entry.outcome === 'failed' || entry.outcome === 'rejected').length}</strong></div><div class="stat"><span class="muted">Max projection lag</span><strong>${Math.max(0, ...(overview()?.sources.map((source) => source.projectionLag) ?? []))}</strong></div></section>
      <div class="grid"><div><section class="panel"><h2>Whole-Slice map</h2><${SliceMap} specification=${item} /></section><section class="panel"><h2>Given / When / Then lanes</h2><div class="lane-tabs" role="tablist">${doc.scenarios.map((scenario, index) => html`<button class="lane-tab" role="tab" aria-selected=${selectedScenario() === index} onClick=${() => setSelectedScenario(index)}>${index + 1}. ${scenario.description}</button>`)}</div><div class="gwt"><article class="step"><h3>Given</h3><pre>${json(lane.given)}</pre></article><article class="step"><h3>When</h3><pre>${json('when' in lane ? lane.when : { trigger: 'events applied' })}</pre></article><article class="step"><h3>Then · ${then.status}</h3><pre>${json(then.value)}</pre></article></div></section></div>
      <section class="panel"><h2>Correlated telemetry</h2><div class="activity">${
        correlated().length
          ? correlated()
              .slice()
              .reverse()
              .map(
                (entry) =>
                  html`<article class="activity-item"><span class=${`kind ${entry.outcome === 'failed' || entry.outcome === 'rejected' ? 'failure' : ''}`}>${entry.kind}</span><div><button class="operation" onClick=${() => void showTrace(entry)}>${entry.operationId}</button><div class="muted">${entry.source.application} · ${entry.observedAt}</div></div><span class=${`status ${entry.outcome === 'failed' || entry.outcome === 'rejected' ? 'rejected' : 'accepted'}`}>${entry.outcome ?? 'active'}</span></article>`,
              )
          : html`<p class="empty">No telemetry has resolved to this exact digest yet.</p>`
      }</div>${() => (trace() ? html`<div class="trace"><h3>Causal trace · ${trace()?.operationId}</h3><p class="muted">${trace()?.observations.length} observations · ${trace()?.edges.length} causal edges</p><pre class="payload">${json(trace())}</pre></div>` : null)}</section></div>`
    }}</main>
  </div>`
}

const root = document.getElementById('app')
if (!root) throw new Error('Specter dashboard root is missing.')
render(App, root)
