import type { JsonValue, ScenarioEvent } from '@specter-ts/spec'
import { createMemo, createSignal } from 'solid-js'
import html from 'solid-js/html'
import { render } from 'solid-js/web'

import type {
  CollectedRuntimeObservation,
  RuntimeOverview,
  RuntimeTrace,
} from './collector-model'
import {
  applicationEnvironmentCountLabel,
  applicationRuntimeGroups,
  dashboardHealthMessage,
  mergeRecentRuntimeActivity,
  observationMatchesScope,
  relativeRuntimeTime,
  runtimeSourceIdentity,
  runtimeSignalStatus,
  summarizeSpecificationRuntimeScope,
  summarizeRuntimeScope,
  type RuntimeScope,
} from './dashboard-model'
import {
  canonicalDashboardLocation,
  dashboardSearch,
  parseDashboardLocation,
  scenarioTabIndexForKey,
  type DashboardLocation,
  type DashboardView,
} from './dashboard-navigation'
import {
  buildContractGraph,
  focusedContractGraph,
  type ContractNode,
} from './dashboard-relationships'
import {
  humanizeLabel,
  presentValue,
  type SemanticValue,
} from './dashboard-presentation'
import type { CollectedSpecification } from './specification-catalog'

const base =
  document.querySelector<HTMLMetaElement>('meta[name="specter-base"]')
    ?.content ?? ''
const initialLocation = parseDashboardLocation(window.location.search)
const [specifications, setSpecifications] = createSignal<
  readonly CollectedSpecification[]
>([])
const [overview, setOverview] = createSignal<RuntimeOverview>()
const [activity, setActivity] = createSignal<
  readonly CollectedRuntimeObservation[]
>([])
const [view, setView] = createSignal<DashboardView>(initialLocation.view)
const [selectedDigest, setSelectedDigest] = createSignal(initialLocation.digest)
const [selectedScenario, setSelectedScenario] = createSignal(
  initialLocation.scenario,
)
const [application, setApplication] = createSignal(initialLocation.application)
const [environment, setEnvironment] = createSignal(initialLocation.environment)
const [selectedSource, setSelectedSource] = createSignal(initialLocation.source)
const [search, setSearch] = createSignal(initialLocation.search)
const [guidedStage, setGuidedStage] = createSignal<0 | 1 | 2 | 3>(
  initialLocation.guidedStage,
)
const [trace, setTrace] = createSignal<RuntimeTrace>()
const [linkCopied, setLinkCopied] = createSignal(false)
const [loadError, setLoadError] = createSignal('')
const [streamError, setStreamError] = createSignal('')
const [lastLoadedAt, setLastLoadedAt] = createSignal<number>()
const [currentTime, setCurrentTime] = createSignal(Date.now())
let refreshSequence = 0

function currentLocation(): DashboardLocation {
  return {
    view: view(),
    application: application(),
    environment: environment(),
    digest: selectedDigest(),
    scenario: selectedScenario(),
    source: selectedSource(),
    search: search(),
    guidedStage: guidedStage(),
  }
}

function applyLocation(next: DashboardLocation) {
  setView(next.view)
  setApplication(next.application)
  setEnvironment(next.environment)
  setSelectedDigest(next.digest)
  setSelectedScenario(next.scenario)
  setSelectedSource(next.source)
  setSearch(next.search)
  setGuidedStage(next.guidedStage)
  setTrace()
}

function navigate(
  patch: Partial<DashboardLocation>,
  historyMode: 'push' | 'replace' = 'push',
) {
  const next = { ...currentLocation(), ...patch }
  applyLocation(next)
  const url = `${window.location.pathname}${dashboardSearch(next)}${window.location.hash}`
  if (historyMode === 'push') window.history.pushState({}, '', url)
  else window.history.replaceState({}, '', url)
}

async function refresh() {
  const sequence = ++refreshSequence
  let specs: readonly CollectedSpecification[]
  let summary: RuntimeOverview
  let recent: readonly CollectedRuntimeObservation[]
  try {
    ;[specs, summary, recent] = await Promise.all([
      dashboardRequest<CollectedSpecification[]>(`${base}/v1/specifications`),
      dashboardRequest<RuntimeOverview>(`${base}/v1/overview`),
      dashboardRequest<CollectedRuntimeObservation[]>(
        `${base}/v1/activity?limit=200`,
      ),
    ])
    if (sequence !== refreshSequence) return
    setLoadError('')
  } catch (cause) {
    if (sequence !== refreshSequence) return
    setLoadError(
      cause instanceof Error ? cause.message : 'Dashboard data is unavailable.',
    )
    return
  }
  setSpecifications(specs)
  setOverview(summary)
  setActivity(recent)
  const loadedAt = Date.now()
  setLastLoadedAt(loadedAt)
  setCurrentTime(loadedAt)

  const current = currentLocation()
  const canonical = canonicalDashboardLocation(current, specs)
  if (JSON.stringify(current) !== JSON.stringify(canonical))
    navigate(canonical, 'replace')
}

async function dashboardRequest<T>(url: string): Promise<T> {
  const separator = url.includes('?') ? '&' : '?'
  const response = await fetch(`${url}${separator}_=${Date.now()}`, {
    cache: 'no-store',
  })
  if (!response.ok)
    throw new Error(
      `Dashboard data request failed with HTTP ${response.status}.`,
    )
  return response.json() as Promise<T>
}

const selected = createMemo(() =>
  specifications().find((item) => item.digest === selectedDigest()),
)
const selectedScope = createMemo<RuntimeScope | undefined>(() => {
  if (!application() || !environment()) return undefined
  return {
    application: application(),
    environment: environment(),
    ...(selectedSource() ? { source: selectedSource() } : {}),
  }
})
const visible = createMemo(() => {
  const query = search().trim().toLowerCase()
  const scope = selectedScope()
  return specifications().filter(
    (item) =>
      (!query ||
        item.document.name.toLowerCase().includes(query) ||
        item.document.description.toLowerCase().includes(query) ||
        item.sources.some((source) =>
          source.application.toLowerCase().includes(query),
        )) &&
      (view() === 'home' ||
        !scope ||
        item.sources.some(
          (source) =>
            source.application === scope.application &&
            source.environment === scope.environment,
        )),
  )
})
const scopedSources = createMemo(() => {
  const current = selected()
  const scope = selectedScope()
  if (!current || !scope) return []
  return current.sources.filter(
    (source) =>
      source.application === scope.application &&
      source.environment === scope.environment,
  )
})
const correlated = createMemo(() => {
  const scope = selectedScope()
  if (!scope || !selected()) return []
  return activity().filter((item) =>
    observationMatchesScope(item, scope, selectedDigest()),
  )
})
const specificationSummary = createMemo(() => {
  const scope = selectedScope()
  return scope
    ? summarizeSpecificationRuntimeScope(overview(), scope, selectedDigest())
    : { executions: 0, failures: 0, rejections: 0 }
})
const scopeSummary = createMemo(() => {
  const scope = selectedScope()
  return scope
    ? summarizeRuntimeScope(overview(), scope)
    : {
        observations: 0,
        failures: 0,
        rejections: 0,
        dropped: 0,
        maxProjectionLag: 0,
      }
})
const applicationGroups = createMemo(() =>
  applicationRuntimeGroups(specifications(), overview()),
)
const relationshipGraph = createMemo(() => {
  const scope = selectedScope()
  return scope
    ? focusedContractGraph(
        buildContractGraph(specifications(), scope),
        selectedDigest(),
      )
    : { nodes: [], edges: [] }
})

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
    runtimeLanguage: entry.source.runtimeLanguage,
    runtimeVersion: entry.source.runtimeVersion,
    instanceId: entry.source.instanceId,
    eventLogId: entry.source.eventLogId,
  })
  try {
    const response = await fetch(
      `${base}/v1/traces/${encodeURIComponent(entry.operationId)}?${parameters}`,
      { cache: 'no-store' },
    )
    if (!response.ok)
      throw new Error(`Trace request failed with HTTP ${response.status}.`)
    setTrace((await response.json()) as RuntimeTrace)
  } catch (cause) {
    setLoadError(
      cause instanceof Error ? cause.message : 'Runtime trace is unavailable.',
    )
  }
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

function openSpecification(
  item: CollectedSpecification,
  app: string,
  env: string,
  nextView: DashboardView = 'slice',
) {
  navigate({
    view: nextView,
    application: app,
    environment: env,
    digest: item.digest,
    scenario: 0,
    source: '',
    guidedStage: 0,
  })
}

function ApplicationHome() {
  const groups = applicationGroups()
  const totals = () => ({
    observations: overview()?.observationCount ?? 0,
    failures: overview()?.failureCount ?? 0,
    rejections: overview()?.rejectionCount ?? 0,
    dropped: overview()?.droppedObservationCount ?? 0,
  })
  return html`<div class="home-view">
    <header class="home-hero"><div><span class="eyebrow">Collector history</span><h1>Applications & runtime signals</h1><p>See what this collector has observed, then open a behavior specification for the exact application and environment.</p></div><span class="evidence-window">Freshness window · 15 minutes</span></header>
    <section class="stats home-stats"><div class="stat"><span class="muted">${applicationEnvironmentCountLabel}</span><strong>${groups.length}</strong></div><div class="stat"><span class="muted">Observations</span><strong>${totals().observations}</strong></div><div class="stat failure-stat"><span class="muted">Failures</span><strong>${totals().failures}</strong></div><div class="stat"><span class="muted">Expected rejections</span><strong>${totals().rejections}</strong></div><div class="stat"><span class="muted">Dropped telemetry</span><strong>${totals().dropped}</strong></div></section>
    <section class="application-grid">${
      groups.length
        ? groups.map((group) => {
            const status = runtimeSignalStatus(group.summary, currentTime())
            return html`<article class="application-card"><header><div><span class="environment-label">${group.environment}</span><h2>${group.application}</h2></div><span class=${`signal-status ${status.tone}`}><i></i>${status.label}</span></header>
              <div class="signal-grid"><div><span>Specifications</span><strong>${group.specifications.length}</strong></div><div><span>Runtime sources</span><strong>${group.sourceCount}</strong></div><div><span>Failures</span><strong>${group.summary.failures}</strong></div><div><span>Rejections</span><strong>${group.summary.rejections}</strong></div><div><span>Max source lag</span><strong>${group.summary.maxProjectionLag}</strong></div><div><span>Last evidence</span><strong title=${group.summary.lastObservedAt ?? ''}>${relativeRuntimeTime(group.summary.lastObservedAt, currentTime())}</strong></div></div>
              <div class="application-specs">${group.specifications.map(
                (item) =>
                  html`<button onClick=${() =>
                    openSpecification(
                      item,
                      group.application,
                      group.environment,
                    )}><span class=${`slice-kind ${item.document.kind}`}>${item.document.kind}</span><span><strong>${humanizeLabel(item.document.name)}</strong><small>${item.document.description}</small></span><span class="open-arrow">→</span></button>`,
              )}</div>
            </article>`
          })
        : html`<article class="panel empty"><h2>No runtime evidence yet</h2><p>Start an opted-in Specter runtime to publish specifications and observations.</p></article>`
    }</section>
  </div>`
}

function copyCurrentLink() {
  void navigator.clipboard
    .writeText(window.location.href)
    .then(() => {
      setLinkCopied(true)
      window.setTimeout(() => setLinkCopied(false), 1800)
    })
    .catch((cause) =>
      setLoadError(
        cause instanceof Error ? cause.message : 'Could not copy the link.',
      ),
    )
}

function SliceToolbar() {
  return html`<div class="slice-toolbar"><nav class="view-tabs" aria-label="Slice views"><button aria-current=${view() === 'slice'} onClick=${() => navigate({ view: 'slice', guidedStage: 0 })}>Scenarios</button><button aria-current=${view() === 'relationships'} onClick=${() => navigate({ view: 'relationships', guidedStage: 0 })}>Relationships</button></nav><div class="toolbar-actions">
    <label class="source-select"><span>Runtime source</span><select value=${selectedSource()} onChange=${(
      event: Event,
    ) =>
      navigate(
        { source: (event.currentTarget as HTMLSelectElement).value },
        'replace',
      )}><option value="" selected=${!selectedSource()}>All sources in environment</option>${scopedSources().map(
      (source) => {
        const identity = runtimeSourceIdentity(source)
        return html`<option value=${identity} selected=${identity === selectedSource()}>${source.runtimeLanguage} ${source.runtimeVersion} · ${source.instanceId} · ${source.eventLogId}</option>`
      },
    )}</select></label>
    ${
      view() === 'slice'
        ? html`<button class="secondary-button review-button" onClick=${() => navigate({ guidedStage: guidedStage() ? 0 : 1 })}>${guidedStage() ? 'Exit review' : 'Guided review'}</button>`
        : null
    }
    <button class="secondary-button" onClick=${copyCurrentLink}>${linkCopied() ? 'Link copied' : 'Copy link'}</button><button class="secondary-button print-button" onClick=${() => window.print()}>Print</button>
  </div></div>`
}

function SliceHeader(props: { item: CollectedSpecification }) {
  const doc = props.item.document
  return html`<header class="slice-page-header"><div class="breadcrumbs"><button onClick=${() => navigate({ view: 'home', application: '', environment: '', digest: '', scenario: 0, source: '', guidedStage: 0 })}>Applications</button><span>›</span><span>${application()}</span><span>›</span><span>${environment()}</span></div><div class="topbar"><div><div class="eyebrow">${doc.kind} Slice · ${doc.scenarios.length} scenarios</div><h1>${humanizeLabel(doc.name)}</h1><p class="muted">${doc.description}</p><details class="technical-details"><summary>Technical details</summary><code>${props.item.digest}</code><span>First observed ${new Date(props.item.firstPublishedAt).toLocaleString()}</span></details></div></div><${SliceToolbar} /></header>`
}

function RelationshipNodeCard(props: {
  node: ContractNode
  selected: boolean
}) {
  const open = () => {
    if (!props.node.digest) return
    const item = specifications().find(
      (candidate) => candidate.digest === props.node.digest,
    )
    if (item)
      openSpecification(item, application(), environment(), 'relationships')
  }
  const content = html`<span class=${`relationship-node-icon ${props.node.kind}`}>${props.node.kind === 'event' ? 'E' : props.node.kind === 'slice' ? 'S' : 'C'}</span><span><small>${props.node.kind === 'slice' ? props.node.sliceKind : props.node.kind === 'event' ? 'Event' : props.node.kind === 'ambiguous-command' ? 'Multiple command revisions' : 'Command not published'}</small><strong>${humanizeLabel(props.node.label)}</strong></span>`
  return props.node.digest
    ? html`<button class=${`relationship-node ${props.selected ? 'selected' : ''}`} onClick=${open}>${content}</button>`
    : html`<div class="relationship-node">${content}</div>`
}

function RelationshipExplorer(props: { item: CollectedSpecification }) {
  const graph = relationshipGraph()
  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]))
  const selectedId = `slice:${props.item.digest}`
  return html`<section class="panel relationship-panel"><header class="relationship-heading"><div><span class="eyebrow">Portable contract</span><h2>Contract relationship explorer</h2><p>Focused paths around ${humanizeLabel(props.item.document.name)}, derived only from scenario examples published for ${application()} · ${environment()}.</p></div><div class="relationship-legend"><span><i class="slice-dot"></i>Slice</span><span><i class="event-dot"></i>Event</span></div></header><aside class="truth-note"><strong>What these paths mean</strong><span>“Uses in Given” means an event appears in example history. It does not claim runtime causation or a Reaction trigger.</span></aside>
    <div class="relationship-paths">${
      graph.edges.length
        ? graph.edges.map((edge) => {
            const from = nodeMap.get(edge.from)
            const to = nodeMap.get(edge.to)
            if (!from || !to) return null
            return html`<article class="relationship-path"><${RelationshipNodeCard} node=${from} selected=${from.id === selectedId} /><div class=${`relationship-arrow ${edge.kind}`}><span>${edge.label}</span><i>→</i><small>${edge.scenarios.length} scenario${edge.scenarios.length === 1 ? '' : 's'}</small></div><${RelationshipNodeCard} node=${to} selected=${to.id === selectedId} /></article>`
          })
        : html`<div class="empty relationship-empty"><h3>No declared relationships</h3><p>This Slice has no event or follow-up-command relationships in the collected portable examples.</p></div>`
    }</div></section>`
}

function changeScenario(index: number) {
  const count = selected()?.document.scenarios.length ?? 0
  if (!count) return
  navigate(
    {
      scenario: Math.max(0, Math.min(index, count - 1)),
      ...(guidedStage() ? { guidedStage: 1 as const } : {}),
    },
    'replace',
  )
}

function reviewNext() {
  if (guidedStage() < 3)
    navigate({ guidedStage: (guidedStage() + 1) as 1 | 2 | 3 }, 'replace')
  else if (
    selectedScenario() <
    (selected()?.document.scenarios.length ?? 1) - 1
  )
    navigate({ scenario: selectedScenario() + 1, guidedStage: 1 }, 'replace')
  else navigate({ guidedStage: 0 }, 'replace')
}

function reviewPrevious() {
  if (guidedStage() > 1)
    navigate({ guidedStage: (guidedStage() - 1) as 1 | 2 }, 'replace')
  else if (selectedScenario() > 0)
    navigate({ scenario: selectedScenario() - 1, guidedStage: 3 }, 'replace')
}

function scenarioTabId(digest: string, index: number) {
  return `scenario-tab-${digest.replace(/[^a-zA-Z0-9_-]/g, '-')}-${index}`
}

function scenarioPanelId(digest: string) {
  return `scenario-panel-${digest.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

function changeScenarioFromTab(
  event: KeyboardEvent,
  index: number,
  count: number,
  digest: string,
) {
  const next = scenarioTabIndexForKey(event.key, index, count)
  if (next === undefined) return
  event.preventDefault()
  changeScenario(next)
  window.requestAnimationFrame(() =>
    document.getElementById(scenarioTabId(digest, next))?.focus(),
  )
}

function ScenarioExplorer(props: { item: CollectedSpecification }) {
  const doc = props.item.document
  const lane = doc.scenarios[selectedScenario()] ?? doc.scenarios[0]
  if (!lane) return null
  const then = scenarioThen(doc, lane)
  const showStage = (stage: 1 | 2 | 3) =>
    guidedStage() === 0 || guidedStage() === stage
  return html`<section class="panel scenario-panel"><div class="section-heading"><div><span class="eyebrow">Behavior specification</span><h2>Scenarios</h2></div><span class="scenario-count">${doc.scenarios.length} total</span></div>
    <div class="scenario-explorer"><div class="scenario-nav" role="tablist" aria-label="Specification scenarios" aria-orientation="vertical">${doc.scenarios.map(
      (scenario, index) => {
        const outcome = scenarioThen(doc, scenario).status
        return html`<button id=${scenarioTabId(props.item.digest, index)} class="scenario-nav-item" role="tab" aria-selected=${selectedScenario() === index} aria-controls=${scenarioPanelId(props.item.digest)} tabIndex=${selectedScenario() === index ? 0 : -1} onClick=${() => changeScenario(index)} onKeyDown=${(event: KeyboardEvent) => changeScenarioFromTab(event, index, doc.scenarios.length, props.item.digest)}><span class="scenario-number">${String(index + 1).padStart(2, '0')}</span><span class="scenario-label">${scenario.description}</span><span class=${`scenario-outcome ${outcome}`}>${outcome}</span></button>`
      },
    )}</div>
    <article id=${scenarioPanelId(props.item.digest)} class=${`scenario-detail ${guidedStage() ? 'guided' : ''}`} role="tabpanel" aria-labelledby=${scenarioTabId(props.item.digest, selectedScenario())} tabIndex="0"><header class="scenario-header"><div><span class="eyebrow">Scenario ${selectedScenario() + 1}</span><h3>${lane.description}</h3></div><span class=${`status ${then.status}`}>${then.status}</span></header>
      ${
        guidedStage()
          ? html`<div class="review-controls"><button onClick=${reviewPrevious} disabled=${guidedStage() === 1 && selectedScenario() === 0}>← Previous</button><div><strong>Guided review</strong><span>Stage ${guidedStage()} of 3</span><div class="review-progress"><i class=${guidedStage() >= 1 ? 'done' : ''}></i><i class=${guidedStage() >= 2 ? 'done' : ''}></i><i class=${guidedStage() >= 3 ? 'done' : ''}></i></div></div><button class="primary-button" onClick=${reviewNext}>${guidedStage() === 3 && selectedScenario() === doc.scenarios.length - 1 ? 'Finish' : 'Next →'}</button></div>`
          : null
      }
      <div class="scenario-flow">
        ${
          showStage(1)
            ? html`<section class="flow-stage given-stage"><div class="stage-label"><span class="stage-marker">1</span><div><strong>Given</strong><small>Starting state</small></div></div><div class="stage-content">${
                lane.given.length
                  ? lane.given.map(
                      (event) =>
                        html`<${EventCard} event=${event} tone="given" />`,
                    )
                  : html`<article class="semantic-card empty-card"><span class="empty-icon">○</span><div><h4>No prior events</h4><p>The scenario starts with an empty history.</p></div></article>`
              }</div></section>`
            : null
        }
        ${
          showStage(2)
            ? html`<section class="flow-stage when-stage"><div class="stage-label"><span class="stage-marker">2</span><div><strong>When</strong><small>${doc.kind === 'reaction' ? 'Reaction evaluation' : 'Action'}</small></div></div><div class="stage-content"><${ActionCard} kind=${doc.kind} name=${doc.name} value=${('when' in lane ? lane.when : {}) as JsonValue} /></div></section>`
            : null
        }
        ${
          showStage(3)
            ? html`<section class="flow-stage expected-stage"><div class="stage-label"><span class="stage-marker">3</span><div><strong>Expected result</strong><small>${then.status === 'rejected' ? 'Rejection' : 'Outcome'}</small></div></div><div class="stage-content"><${ExpectedCards} kind=${doc.kind} status=${then.status} value=${then.value as JsonValue} /></div></section>`
            : null
        }
      </div>
    </article></div>
  </section>`
}

function SlicePage(props: { item: CollectedSpecification }) {
  return html`<${SliceHeader} item=${props.item} />
    ${
      view() === 'relationships'
        ? html`<${RelationshipExplorer} item=${props.item} />`
        : html`<section class="stats"><div class="stat"><span class="muted">Scenarios</span><strong>${props.item.document.scenarios.length}</strong></div><div class="stat"><span class="muted">Executions</span><strong>${specificationSummary().executions}</strong></div><div class="stat"><span class="muted">Expected rejections</span><strong>${specificationSummary().rejections}</strong></div><div class="stat failure-stat"><span class="muted">Failures</span><strong>${specificationSummary().failures}</strong></div><div class="stat"><span class="muted">Source lag</span><strong>${scopeSummary().maxProjectionLag}</strong></div></section>
        <div class="grid overview-grid"><section class="panel"><h2>Whole-Slice map</h2><${SliceMap} specification=${props.item} /></section>
        <section class="panel telemetry-panel"><div class="panel-heading"><h2>Runtime evidence</h2><span>${selectedSource() ? 'Selected source' : 'All environment sources'}</span></div><div class="activity">${
          correlated().length
            ? correlated()
                .slice()
                .reverse()
                .map(
                  (entry) =>
                    html`<article class="activity-item"><span class=${`kind ${entry.outcome === 'failed' ? 'failure' : ''}`}>${entry.kind}</span><div><button class="operation" onClick=${() => void showTrace(entry)}>${entry.operationId}</button><div class="muted">${entry.source.instanceId} · ${relativeRuntimeTime(entry.observedAt, currentTime())}</div></div><span class=${`status ${entry.outcome === 'failed' ? 'rejected' : entry.outcome === 'rejected' ? 'expected-rejection' : 'accepted'}`}>${entry.outcome ?? 'active'}</span></article>`,
                )
            : html`<p class="empty">No telemetry has resolved to this exact digest and runtime scope.</p>`
        }</div>${
          trace()
            ? html`<div class="trace"><div class="panel-heading"><div><h3>Causal trace</h3><p class="muted">${trace()?.observations.length} observations · ${trace()?.edges.length} causal edges</p></div><button class="icon-button" aria-label="Close trace" onClick=${() => setTrace()}>×</button></div><${ValueView} value=${trace() as unknown as JsonValue} /></div>`
            : null
        }</section></div>
        <${ScenarioExplorer} item=${props.item} />`
    }
  `
}

function App() {
  return html`<div class="shell">
    <aside class="rail"><button class="brand" aria-current=${() => view() === 'home'} onClick=${() => navigate({ view: 'home', application: '', environment: '', digest: '', scenario: 0, source: '', guidedStage: 0 })}><span class="mark"></span><span><strong>Specter</strong><small>Runtime evidence</small></span></button>
      <button class="home-link" aria-current=${() => view() === 'home'} onClick=${() => navigate({ view: 'home', application: '', environment: '', digest: '', scenario: 0, source: '', guidedStage: 0 })}><span>⌂</span>Applications</button>
      <input aria-label="Search applications and Slices" placeholder="Search apps or Slices" value=${search()} onInput=${(
        event: InputEvent,
      ) =>
        navigate(
          { search: (event.currentTarget as HTMLInputElement).value },
          'replace',
        )} />
      <h2>${() =>
        view() === 'home'
          ? 'All specifications'
          : `${application()} · ${environment()}`}</h2>
      <div class="slice-list">${() =>
        visible().map((item) => {
          const source =
            item.sources.find(
              (candidate) =>
                candidate.application === application() &&
                candidate.environment === environment(),
            ) ?? item.sources[0]
          return html`<button class="slice-button" aria-current=${selectedDigest() === item.digest && view() !== 'home'} onClick=${() =>
            openSpecification(
              item,
              source?.application ?? '',
              source?.environment ?? '',
            )}><strong>${humanizeLabel(item.document.name)}</strong><small>${source?.application ?? 'unassociated'} · ${item.document.kind}</small></button>`
        })}</div>
      <div class="rail-help"><strong>Keyboard</strong><span>↑ ↓ scenarios</span><span>← → guided review</span></div>
    </aside>
    <main class="content">${() => {
      specifications()
      overview()
      activity()
      application()
      environment()
      selectedSource()
      selectedScenario()
      guidedStage()
      trace()
      linkCopied()
      loadError()
      streamError()
      lastLoadedAt()
      currentTime()
      const item = selected()
      const health = dashboardHealthMessage(
        loadError(),
        streamError(),
        lastLoadedAt(),
        currentTime(),
      )
      const page =
        view() === 'home' || !item
          ? html`<${ApplicationHome} />`
          : html`<${SlicePage} item=${item} />`
      return html`<div class="content-stack">${
        health
          ? html`<div class="load-error" role="alert"><strong>${health.title}</strong><span>${health.detail}</span><button onClick=${() => void refresh()}>Try again</button></div>`
          : null
      }${page}</div>`
    }}</main>
  </div>`
}

function startDashboard() {
  void refresh()
  const freshnessTimer = window.setInterval(
    () => setCurrentTime(Date.now()),
    30_000,
  )
  const stream =
    typeof EventSource === 'undefined'
      ? undefined
      : new EventSource(`${base}/v1/stream`)
  const activityListener = (event: Event) => {
    try {
      const item = JSON.parse(
        (event as MessageEvent).data,
      ) as CollectedRuntimeObservation
      setActivity((items) => mergeRecentRuntimeActivity(items, item))
      void refresh()
    } catch {
      setStreamError('A live runtime update could not be read.')
    }
  }
  const streamOpenListener = () => setStreamError('')
  const streamErrorListener = () =>
    setStreamError(
      'Live runtime updates are disconnected; the browser is retrying.',
    )
  const popstateListener = () =>
    applyLocation(
      canonicalDashboardLocation(
        parseDashboardLocation(window.location.search),
        specifications(),
      ),
    )
  const keydownListener = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null
    if (target?.matches('input, select, textarea, button')) return
    if (guidedStage() && event.key === 'ArrowRight') {
      event.preventDefault()
      reviewNext()
    } else if (guidedStage() && event.key === 'ArrowLeft') {
      event.preventDefault()
      reviewPrevious()
    } else if (view() === 'slice' && event.key === 'ArrowDown') {
      event.preventDefault()
      changeScenario(selectedScenario() + 1)
    } else if (view() === 'slice' && event.key === 'ArrowUp') {
      event.preventDefault()
      changeScenario(selectedScenario() - 1)
    }
  }
  stream?.addEventListener('activity', activityListener)
  stream?.addEventListener('open', streamOpenListener)
  stream?.addEventListener('error', streamErrorListener)
  if (!stream)
    setStreamError('This browser does not support live runtime updates.')
  window.addEventListener('popstate', popstateListener)
  window.addEventListener('keydown', keydownListener)
  window.addEventListener(
    'pagehide',
    () => {
      window.clearInterval(freshnessTimer)
      stream?.close()
      window.removeEventListener('popstate', popstateListener)
      window.removeEventListener('keydown', keydownListener)
    },
    { once: true },
  )
}

const root = document.getElementById('app')
if (!root) throw new Error('Specter dashboard root is missing.')
root.replaceChildren()
render(App, root)
startDashboard()
