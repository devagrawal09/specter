import { createMemo, createSignal, onMount } from 'solid-js'
import html from 'solid-js/html'
import { render } from 'solid-js/web'
import type { JsonValue, ScenarioEvent } from '@specter-ts/spec'
import type {
  CollectedRuntimeObservation,
  RuntimeOverview,
  RuntimeTrace,
} from './collector-model'
import {
  humanizeLabel,
  presentValue,
  type SemanticValue,
} from './dashboard-presentation'
import type { CollectedSpecification } from './specification-catalog'
import { executionSummary } from './dashboard-model'

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
const correlatedSummary = createMemo(() => executionSummary(correlated()))

function scenarioThen(
  current: CollectedSpecification['document'],
  scenario: (typeof current.scenarios)[number],
) {
  if (current.kind === 'command' && 'reject' in scenario && scenario.reject)
    return { status: 'rejected', value: scenario.reject }
  return { status: 'accepted', value: scenario.expect }
}

function SemanticValueView(props: { value: SemanticValue }) {
  if (props.value.kind === 'scalar')
    return html`<span class=${`semantic-scalar ${props.value.tone}`}>${props.value.text}</span>`
  if (props.value.kind === 'list')
    return props.value.items.length
      ? html`<div class="semantic-list">${props.value.items.map(
          (item, index) =>
            html`<div class="semantic-list-item"><span class="item-number">${index + 1}</span><div><${SemanticValueView} value=${item} /></div></div>`,
        )}</div>`
      : html`<span class="semantic-scalar empty">None</span>`
  return props.value.fields.length
    ? html`<dl class="field-list">${props.value.fields.map(
        (field) =>
          html`<div class="field-row"><dt>${field.label}</dt><dd><${SemanticValueView} value=${field.value} /></dd></div>`,
      )}</dl>`
    : html`<span class="semantic-scalar empty">No details</span>`
}

function ValueView(props: { value: JsonValue }) {
  return html`<${SemanticValueView} value=${presentValue(props.value)} />`
}

function EventCard(props: {
  event: ScenarioEvent
  tone: 'given' | 'expected'
}) {
  return html`<article class=${`semantic-card event-card ${props.tone}`}>
    <header><span class="card-kind">Event</span><h4>${humanizeLabel(props.event.eventType)}</h4></header>
    <${ValueView} value=${props.event.examplePayload as JsonValue} />
  </article>`
}

type CommandEnvelopeValue = {
  readonly type: string
  readonly payload: JsonValue
}

function isScenarioEvent(value: unknown): value is ScenarioEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'scenario-event' &&
    'eventType' in value &&
    typeof value.eventType === 'string' &&
    'examplePayload' in value
  )
}

function isCommandEnvelope(value: unknown): value is CommandEnvelopeValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof value.type === 'string' &&
    'payload' in value
  )
}

function ActionCard(props: { kind: string; name: string; value: JsonValue }) {
  return html`<article class="semantic-card action-card">
    <header><span class="card-kind">${humanizeLabel(props.kind)}</span><h4>${humanizeLabel(props.name)}</h4></header>
    <${ValueView} value=${props.value} />
  </article>`
}

function ExpectedCards(props: {
  kind: CollectedSpecification['document']['kind']
  status: 'accepted' | 'rejected'
  value: JsonValue
}) {
  if (props.status === 'rejected')
    return html`<article class="semantic-card rejection-card">
        <header><span class="card-kind">Rejected</span><h4>Request rejected</h4></header>
        <${ValueView} value=${props.value} />
      </article>`

  if (Array.isArray(props.value)) {
    if (!props.value.length)
      return html`<article class="semantic-card empty-card"><span class="empty-icon">✓</span><div><h4>No output</h4><p>This scenario completes without emitting an event or follow-up action.</p></div></article>`
    if (props.value.every(isScenarioEvent))
      return props.value.map(
        (event) => html`<${EventCard} event=${event} tone="expected" />`,
      )
    if (props.value.every(isCommandEnvelope))
      return props.value.map(
        (command) =>
          html`<${ActionCard} kind="Follow-up command" name=${command.type} value=${command.payload} />`,
      )
  }

  return html`<article class="semantic-card result-card">
      <header><span class="card-kind">${props.kind === 'query' ? 'Result' : 'Outcome'}</span><h4>${props.kind === 'query' ? 'Returned value' : 'Expected outcome'}</h4></header>
      <${ValueView} value=${props.value} />
    </article>`
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
  return html`<svg class="map" viewBox="0 0 780 190" role="img" aria-label="Whole Slice Given When Expected map">
    <defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#98a2b3"/></marker></defs>
    <path d="M230 95 H295 M485 95 H550" stroke="#98a2b3" stroke-width="2" marker-end="url(#arrow)"/>
    <g><rect x="25" y="40" width="205" height="110" rx="14" fill="#eef4ff" stroke="#b2ccff"/><text x="45" y="72" font-size="13" font-weight="700" fill="#1849a9">GIVEN</text><text x="45" y="104" font-size="24" font-weight="700" fill="#18202d">${totalGiven}</text><text x="45" y="126" font-size="12" fill="#667085">event examples across ${doc().scenarios.length} lanes</text></g>
    <g><rect x="295" y="40" width="190" height="110" rx="14" fill="#f4f3ff" stroke="#c7c0ff"/><text x="315" y="72" font-size="13" font-weight="700" fill="#4235a8">WHEN</text><text x="315" y="104" font-size="19" font-weight="700" fill="#18202d">${doc().kind}</text><text x="315" y="126" font-size="12" fill="#667085">${doc().name}</text></g>
    <g><rect x="550" y="40" width="205" height="110" rx="14" fill="#ecfdf3" stroke="#a6f4c5"/><text x="570" y="72" font-size="13" font-weight="700" fill="#067647">EXPECT</text><text x="570" y="104" font-size="24" font-weight="700" fill="#18202d">${doc().scenarios.length}</text><text x="570" y="126" font-size="12" fill="#667085">specified outcomes</text></g>
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
      <section class="stats"><div class="stat"><span class="muted">Scenarios</span><strong>${doc.scenarios.length}</strong></div><div class="stat"><span class="muted">Executions</span><strong>${correlatedSummary().executions}</strong></div><div class="stat"><span class="muted">Failures</span><strong>${correlatedSummary().failures}</strong></div><div class="stat"><span class="muted">Max projection lag</span><strong>${Math.max(0, ...(overview()?.sources.map((source) => source.projectionLag) ?? []))}</strong></div></section>
      <div class="grid"><section class="panel"><h2>Whole-Slice map</h2><${SliceMap} specification=${item} /></section>
      <section class="panel telemetry-panel"><h2>Correlated telemetry</h2><div class="activity">${
        correlated().length
          ? correlated()
              .slice()
              .reverse()
              .map(
                (entry) =>
                  html`<article class="activity-item"><span class=${`kind ${entry.outcome === 'failed' || entry.outcome === 'rejected' ? 'failure' : ''}`}>${entry.kind}</span><div><button class="operation" onClick=${() => void showTrace(entry)}>${entry.operationId}</button><div class="muted">${entry.source.application} · ${entry.observedAt}</div></div><span class=${`status ${entry.outcome === 'failed' || entry.outcome === 'rejected' ? 'rejected' : 'accepted'}`}>${entry.outcome ?? 'active'}</span></article>`,
              )
          : html`<p class="empty">No telemetry has resolved to this exact digest yet.</p>`
      }</div>${() =>
        trace()
          ? html`<div class="trace"><h3>Causal trace</h3><p class="muted">${trace()?.observations.length} observations · ${trace()?.edges.length} causal edges</p><${ValueView} value=${trace() as unknown as JsonValue} /></div>`
          : null}</section></div>
      <section class="panel scenario-panel"><div class="section-heading"><div><span class="eyebrow">Behavior specification</span><h2>Scenarios</h2></div><span class="scenario-count">${doc.scenarios.length} total</span></div>
        <div class="scenario-explorer"><div class="scenario-nav" role="tablist" aria-label="Specification scenarios">${doc.scenarios.map(
          (scenario, index) => {
            const outcome = scenarioThen(doc, scenario).status
            return html`<button class="scenario-nav-item" role="tab" aria-selected=${selectedScenario() === index} onClick=${() => setSelectedScenario(index)}><span class="scenario-number">${String(index + 1).padStart(2, '0')}</span><span class="scenario-label">${scenario.description}</span><span class=${`scenario-outcome ${outcome}`}>${outcome}</span></button>`
          },
        )}</div>
        <article class="scenario-detail"><header class="scenario-header"><div><span class="eyebrow">Scenario ${selectedScenario() + 1}</span><h3>${lane.description}</h3></div><span class=${`status ${then.status}`}>${then.status}</span></header>
          <div class="scenario-flow">
            <section class="flow-stage given-stage"><div class="stage-label"><span class="stage-marker">1</span><div><strong>Given</strong><small>Starting state</small></div></div><div class="stage-content">${
              lane.given.length
                ? lane.given.map(
                    (event) =>
                      html`<${EventCard} event=${event} tone="given" />`,
                  )
                : html`<article class="semantic-card empty-card"><span class="empty-icon">○</span><div><h4>No prior events</h4><p>The scenario starts with an empty history.</p></div></article>`
            }</div></section>
            <section class="flow-stage when-stage"><div class="stage-label"><span class="stage-marker">2</span><div><strong>When</strong><small>${doc.kind === 'reaction' ? 'Trigger' : 'Action'}</small></div></div><div class="stage-content"><${ActionCard} kind=${doc.kind} name=${doc.name} value=${('when' in lane ? lane.when : { trigger: 'Events applied' }) as JsonValue} /></div></section>
            <section class="flow-stage expected-stage"><div class="stage-label"><span class="stage-marker">3</span><div><strong>Expected result</strong><small>${then.status === 'rejected' ? 'Rejection' : 'Outcome'}</small></div></div><div class="stage-content"><${ExpectedCards} kind=${doc.kind} status=${then.status} value=${then.value as JsonValue} /></div></section>
          </div>
        </article></div>
      </section>`
    }}</main>
  </div>`
}

const root = document.getElementById('app')
if (!root) throw new Error('Specter dashboard root is missing.')
root.replaceChildren()
render(App, root)
