import { baselineBot } from '../bots/baseline'
import {
  streamColonyBenchLoop,
  type ColonyBenchRunFrame,
  type RunColonyBenchLoopResult,
} from '../runner/run-loop'
import {
  buildColonyBenchGameModel,
  type ColonyBenchGameModel,
  type ColonyBenchGameStatus,
} from './model'
import type { ColonyBenchPosition } from '../simulation/state'
import { renderColonyBenchSvgBoard } from './svg-board'

const RUN_TICKS = 80
const DEFAULT_DELAY_MS = 300

type RenderState = {
  model: ColonyBenchGameModel
  latestFrame: ColonyBenchRunFrame | null
  iterator: AsyncIterator<ColonyBenchRunFrame, RunColonyBenchLoopResult> | null
  status: ColonyBenchGameStatus
  paused: boolean
  advancing: boolean
  frameCount: number
  delayMs: number
  runToken: number
  message: string
  selectedCell: ColonyBenchPosition | null
}

export function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function rebuildModel(state: RenderState) {
  state.model = buildColonyBenchGameModel({
    frame: state.latestFrame,
    status: state.status,
    frameCount: state.frameCount,
    selectedCell: state.selectedCell,
  })
}

function displayStatus(state: RenderState) {
  if (state.paused && state.status === 'idle' && state.latestFrame)
    return 'paused'
  return state.model.status
}

function parseCellPosition(value: string): ColonyBenchPosition | null {
  const [x, y] = value.split(',').map(Number)
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}

function renderActivity(title: string, labels: string[], empty: string) {
  return `<section class="activity-panel">
    <h3>${title}</h3>
    <ol>
      ${
        labels.length === 0
          ? `<li class="muted">${escapeHtml(empty)}</li>`
          : labels.map((label) => `<li>${escapeHtml(label)}</li>`).join('')
      }
    </ol>
  </section>`
}

function renderLegend() {
  return `<section class="legend-panel" aria-label="How to read ColonyBench">
    <div>
      <h3>How to play the demo</h3>
      <p>Start streams the real baseline bot. Pause freezes the same run. Step advances one frame.</p>
    </div>
    <div class="legend-list">
      <span><b class="legend-token legend-token--base"></b>Spawn stores energy and creates workers</span>
      <span><b class="legend-token legend-token--controller"></b>Controller levels up when upgraded</span>
      <span><b class="legend-token legend-token--worker"></b>Workers harvest, return, spawn, and upgrade</span>
      <span><b class="legend-token legend-token--source"></b>Sources regenerate each tick</span>
      <span><b class="legend-token legend-token--terrain"></b>Walls are impassable terrain</span>
      <span><b class="legend-token legend-token--construction"></b>Construction sites become roads when built</span>
      <span><b class="legend-token legend-token--intent"></b>Intent markers show current bot command targets</span>
    </div>
  </section>`
}

function renderDetailList(title: string, labels: string[], empty: string) {
  return `<section class="detail-panel">
    <h3>${escapeHtml(title)}</h3>
    <ul>
      ${
        labels.length === 0
          ? `<li class="muted">${escapeHtml(empty)}</li>`
          : labels.map((label) => `<li>${escapeHtml(label)}</li>`).join('')
      }
    </ul>
  </section>`
}

function renderSelectedCellDetails(model: ColonyBenchGameModel) {
  const selected = model.selectedCellDetails
  return `<section class="detail-panel detail-panel--inspector" aria-label="Selected cell inspector">
    <h3>${escapeHtml(selected?.title ?? 'Cell inspector')}</h3>
    <ul>
      ${
        selected
          ? selected.details
              .map((detail) => `<li>${escapeHtml(detail)}</li>`)
              .join('')
          : '<li class="muted">Select a board cell to inspect every object occupying it.</li>'
      }
    </ul>
  </section>`
}

function renderEntityDetails(model: ColonyBenchGameModel) {
  return `<section class="detail-panel detail-panel--entities">
    <h3>Colony roster</h3>
    <div class="entity-detail-grid">
      <article>
        <strong>Base</strong>
        <ul>${model.baseDetails.map((detail) => `<li>${escapeHtml(detail)}</li>`).join('')}</ul>
      </article>
      <article>
        <strong>Workers</strong>
        <ul>${
          model.workerDetails.length === 0
            ? '<li class="muted">No workers yet.</li>'
            : model.workerDetails
                .map(
                  (worker) =>
                    `<li><b>${escapeHtml(worker.id)}</b>: ${escapeHtml(worker.activity)} · ${escapeHtml(worker.detail)}</li>`,
                )
                .join('')
        }</ul>
      </article>
      <article>
        <strong>Sources</strong>
        <ul>${
          model.sourceDetails.length === 0
            ? '<li class="muted">No sources found.</li>'
            : model.sourceDetails
                .map(
                  (source) =>
                    `<li><b>${escapeHtml(source.id)}</b>: ${escapeHtml(source.detail)} · ${escapeHtml(source.activity)}</li>`,
                )
                .join('')
        }</ul>
      </article>
      <article>
        <strong>Construction</strong>
        <ul>${
          model.constructionDetails.length === 0
            ? '<li class="muted">No active construction sites.</li>'
            : model.constructionDetails
                .map(
                  (site) =>
                    `<li><b>${escapeHtml(site.id)}</b>: ${escapeHtml(site.detail)} · ${escapeHtml(site.activity)}</li>`,
                )
                .join('')
        }</ul>
      </article>
    </div>
  </section>`
}

function render(root: HTMLElement, state: RenderState) {
  const canPause = state.status === 'running'
  const canResume =
    state.paused && state.latestFrame && state.status !== 'completed'

  root.innerHTML = `<main class="shell">
    <section class="hero">
      <div>
        <p class="eyebrow">Reference benchmark</p>
        <h1>ColonyBench</h1>
        <p class="lede">A live baseline bot colony simulation streamed from the real runtime.</p>
      </div>
      <div class="controls" aria-label="Simulation controls">
        <button id="restart-run" type="button">${state.latestFrame ? 'Restart' : 'Start'}</button>
        <button id="toggle-pause" type="button" ${canPause || canResume ? '' : 'disabled'}>
          ${state.paused ? 'Resume' : 'Pause'}
        </button>
        <button id="step-run" type="button" ${state.advancing ? 'disabled' : ''}>Step</button>
        <label class="speed-control">
          Speed
          <select id="speed-select">
            ${[120, 300, 650, 1000]
              .map(
                (value) =>
                  `<option value="${value}" ${state.delayMs === value ? 'selected' : ''}>${value}ms/tick</option>`,
              )
              .join('')}
          </select>
        </label>
      </div>
    </section>

    <section class="hud" aria-live="polite">
      <div>
        <p class="label">Run status</p>
        <h2>${displayStatus(state)}</h2>
        <p class="message">${escapeHtml(state.message)}</p>
      </div>
      <div class="metrics">
        ${state.model.metrics
          .map(
            (metric) => `<div class="metric">
              <span>${escapeHtml(metric.label)}</span>
              <strong>${escapeHtml(metric.value)}</strong>
            </div>`,
          )
          .join('')}
      </div>
    </section>

    <section class="game-layout">
      <div class="board-card">
        <div class="board-heading">
          <div>
            <p class="label">World grid</p>
            <h2>Tick ${state.model.tick}</h2>
          </div>
          <span>${state.model.frameCount} frames</span>
        </div>
        ${renderLegend()}
        <div class="board board--svg">
          ${renderColonyBenchSvgBoard({ model: state.model, selectedCell: state.selectedCell })}
        </div>
      </div>
      <aside class="sidebar">
        ${renderSelectedCellDetails(state.model)}
        ${renderEntityDetails(state.model)}
        ${renderDetailList('Activity history', state.model.activityHistory, 'No activity yet. Start or step the run.')}
        ${renderActivity('Bot API intents', state.model.recentApiIntents, 'No Screeps-like API calls on this frame.')}
        ${renderActivity('Commands', state.model.recentCommands, 'No bot commands on this frame.')}
        ${renderActivity('Events', state.model.recentEvents, 'No simulation events on this frame.')}
      </aside>
    </section>
  </main>`
}

function createRunIterator() {
  return streamColonyBenchLoop({
    runId: `baseline-${Date.now()}`,
    ticks: RUN_TICKS,
    bot: baselineBot,
  })[Symbol.asyncIterator]()
}

async function advanceFrame(state: RenderState) {
  if (state.advancing) return 'advanced'
  state.advancing = true
  state.iterator ??= createRunIterator()

  try {
    const result = await state.iterator.next()
    if (result.done) {
      state.status = 'completed'
      state.paused = false
      state.message = `completed: baselineBot finished ${result.value.ticks} ticks`
      return 'completed'
    }

    state.latestFrame = result.value
    state.frameCount += 1
    state.message = `streamed real frame for tick ${result.value.tick}`
    return 'advanced'
  } finally {
    state.advancing = false
    rebuildModel(state)
  }
}

async function autoRun(root: HTMLElement, state: RenderState, token: number) {
  while (
    token === state.runToken &&
    state.status === 'running' &&
    !state.paused
  ) {
    await wait(state.delayMs)
    if (token !== state.runToken || state.status !== 'running' || state.paused)
      return
    await advanceFrame(state)
    render(root, state)
  }
}

async function startRun(root: HTMLElement, state: RenderState) {
  state.runToken += 1
  state.iterator = createRunIterator()
  state.latestFrame = null
  state.frameCount = 0
  state.selectedCell = null
  state.status = 'running'
  state.paused = false
  state.message = 'started: baselineBot is driving the real simulation stream'
  rebuildModel(state)
  render(root, state)

  await advanceFrame(state)
  render(root, state)
  void autoRun(root, state, state.runToken)
}

async function stepRun(root: HTMLElement, state: RenderState) {
  if (state.status === 'completed') {
    state.runToken += 1
    state.iterator = createRunIterator()
    state.latestFrame = null
    state.frameCount = 0
  }

  state.runToken += 1
  state.status = 'idle'
  state.paused = Boolean(state.latestFrame)
  state.message = 'stepping: advancing one real baseline frame'
  rebuildModel(state)
  render(root, state)

  const stepResult = await advanceFrame(state)
  if (stepResult !== 'completed') {
    state.status = 'idle'
    state.paused = true
    rebuildModel(state)
  }
  render(root, state)
}

function resumeRun(root: HTMLElement, state: RenderState) {
  state.runToken += 1
  state.status = 'running'
  state.paused = false
  state.message = 'resumed: streaming real baseline frames'
  rebuildModel(state)
  render(root, state)
  void autoRun(root, state, state.runToken)
}

function pauseRun(root: HTMLElement, state: RenderState) {
  state.runToken += 1
  state.status = 'idle'
  state.paused = true
  state.message = 'paused: use Resume or Step to continue the same real run'
  rebuildModel(state)
  render(root, state)
}

export function mountColonyBenchApp(root: HTMLElement) {
  const state: RenderState = {
    model: buildColonyBenchGameModel({
      frame: null,
      status: 'idle',
      frameCount: 0,
    }),
    latestFrame: null,
    iterator: null,
    status: 'idle',
    paused: false,
    advancing: false,
    frameCount: 0,
    delayMs: DEFAULT_DELAY_MS,
    runToken: 0,
    message: 'Idle. Start or step the baseline bot to stream real frames.',
    selectedCell: null,
  }

  root.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof Element)) return

    const cellButton = target.closest('[data-cell-position]')
    if (cellButton) {
      const selectedCell = parseCellPosition(
        cellButton.getAttribute('data-cell-position') ?? '',
      )
      if (selectedCell) {
        state.selectedCell = selectedCell
        rebuildModel(state)
        render(root, state)
      }
      return
    }

    const button = target.closest('button')
    if (button?.id === 'restart-run') {
      void startRun(root, state).catch((error: unknown) => {
        state.status = 'idle'
        state.paused = false
        state.message =
          error instanceof Error ? error.message : 'Baseline run failed'
        rebuildModel(state)
        render(root, state)
      })
    }

    if (button?.id === 'toggle-pause') {
      if (state.paused) resumeRun(root, state)
      else pauseRun(root, state)
    }

    if (button?.id === 'step-run') {
      void stepRun(root, state).catch((error: unknown) => {
        state.status = 'idle'
        state.paused = false
        state.message = error instanceof Error ? error.message : 'Step failed'
        rebuildModel(state)
        render(root, state)
      })
    }
  })

  root.addEventListener('change', (event) => {
    const target = event.target
    if (!(target instanceof HTMLSelectElement) || target.id !== 'speed-select')
      return
    state.delayMs = Number(target.value)
    render(root, state)
  })

  render(root, state)
}
