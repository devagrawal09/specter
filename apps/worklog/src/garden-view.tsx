import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from 'solid-js'

import { buildGardenPlots, recordKey, stableNumber } from './garden-layout'
import type {
  GardenConnection,
  GardenEffectReason,
  GardenMood,
  GardenRecord,
  GardenSnapshot,
} from './garden-types'

type VineGeometry = {
  connection: GardenConnection
  path: string
  x: number
  y: number
}

export function GardenView(props: {
  snapshot: GardenSnapshot
  mood: GardenMood
  setMood: (mood: GardenMood) => void
}) {
  const plots = createMemo(() => buildGardenPlots(props.snapshot))
  const [selected, setSelected] = createSignal<string>()
  const [vines, setVines] = createSignal<VineGeometry[]>([])
  let board: HTMLDivElement | undefined
  let resizeObserver: ResizeObserver | undefined
  let frame = 0

  const selectedRecord = createMemo(() =>
    props.snapshot.records.find((record) => recordKey(record) === selected()),
  )
  const selectedConnection = createMemo(() =>
    props.snapshot.connections.find(
      (connection) => `connection:${connection.id}` === selected(),
    ),
  )

  function scheduleVines() {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(measureVines)
  }

  function measureVines() {
    if (!board) return
    const boardRect = board.getBoundingClientRect()
    const points = new Map<string, { x: number; y: number }>()
    for (const element of board.querySelectorAll<HTMLElement>(
      '[data-garden-ref]',
    )) {
      const key = element.dataset.gardenRef
      if (!key) continue
      const rect = element.getBoundingClientRect()
      points.set(key, {
        x: rect.left - boardRect.left + rect.width / 2,
        y: rect.top - boardRect.top + rect.height * 0.72,
      })
    }
    setVines(
      props.snapshot.connections.flatMap((connection) => {
        const left = points.get(recordKey(connection.left))
        const right = points.get(recordKey(connection.right))
        if (!left || !right) return []
        const middleX = (left.x + right.x) / 2
        return [
          {
            connection,
            path: `M ${left.x} ${left.y} C ${middleX} ${left.y}, ${middleX} ${right.y}, ${right.x} ${right.y}`,
            x: middleX,
            y: (left.y + right.y) / 2,
          },
        ]
      }),
    )
  }

  createEffect(
    () =>
      `${plots()
        .flatMap((plot) => plot.records.map(recordKey))
        .join('|')}::${props.snapshot.connections
        .map((connection) => `${connection.id}:${connection.archived}`)
        .join('|')}`,
    () => scheduleVines(),
  )

  queueMicrotask(() => {
    const element = board
    if (!element || resizeObserver) return
    resizeObserver = new ResizeObserver(scheduleVines)
    resizeObserver.observe(element)
    scheduleVines()
  })
  onCleanup(() => {
    cancelAnimationFrame(frame)
    resizeObserver?.disconnect()
  })

  return (
    <section class={`garden-view mood-${props.mood}`}>
      <div class="garden-toolbar">
        <div>
          <p class="eyebrow">Lifetime garden</p>
          <h1>Your work is growing.</h1>
          <p>
            {props.snapshot.records.length} plants ·{' '}
            {props.snapshot.connections.length} vines ·{' '}
            {props.snapshot.totalPoints} points
          </p>
        </div>
        <fieldset class="mood-picker">
          <legend>Garden mood</legend>
          <For each={['day', 'sunset', 'night'] as GardenMood[]}>
            {(mood) => (
              <button
                type="button"
                class={props.mood === mood ? 'active' : ''}
                aria-pressed={props.mood === mood ? 'true' : 'false'}
                onClick={() => props.setMood(mood)}
              >
                {mood}
              </button>
            )}
          </For>
        </fieldset>
      </div>

      <div class="garden-scene">
        <div class="garden-sky" aria-hidden="true">
          <span class="garden-orb" />
          <span class="garden-cloud cloud-one" />
          <span class="garden-cloud cloud-two" />
          <span class="garden-firefly firefly-one" />
          <span class="garden-firefly firefly-two" />
          <span class="garden-firefly firefly-three" />
        </div>

        <div class="garden-content">
          <div class="garden-board" ref={board}>
            <svg
              class="garden-vines"
              width="100%"
              height="100%"
              aria-hidden="true"
            >
              <For each={vines()}>
                {(vine) => (
                  <path class={vineClass(vine.connection)} d={vine.path} />
                )}
              </For>
            </svg>

            <div class="garden-plots">
              <For each={plots()}>
                {(plot) => (
                  <section
                    class={`garden-plot palette-${plot.palette}`}
                    aria-label={
                      plot.kind === 'meadow' ? 'Meadow' : 'Topic garden plot'
                    }
                  >
                    <div class="garden-plot-heading">
                      <span>
                        {plot.kind === 'meadow' ? 'Open meadow' : 'Topic grove'}
                      </span>
                      <small>{plot.records.length} plants</small>
                    </div>
                    <div class="garden-bed">
                      <For each={plot.records}>
                        {(record) => (
                          <PlantButton
                            record={record}
                            selected={selected() === recordKey(record)}
                            select={() => setSelected(recordKey(record))}
                          />
                        )}
                      </For>
                    </div>
                  </section>
                )}
              </For>
            </div>

            <For each={vines()}>
              {(vine) => (
                <button
                  type="button"
                  class={`${vineClass(vine.connection)} vine-marker${
                    selected() === `connection:${vine.connection.id}`
                      ? ' selected'
                      : ''
                  }`}
                  style={{ left: `${vine.x}px`, top: `${vine.y}px` }}
                  aria-label={connectionLabel(vine.connection, props.snapshot)}
                  data-label={connectionLabel(vine.connection, props.snapshot)}
                  onClick={() => {
                    setSelected(`connection:${vine.connection.id}`)
                  }}
                >
                  <span aria-hidden="true">✦</span>
                  <span class="plant-tooltip">
                    {connectionLabel(vine.connection, props.snapshot)}
                  </span>
                </button>
              )}
            </For>
          </div>

          <aside class="garden-inspector" aria-live="polite">
            <Show
              when={selectedRecord() || selectedConnection()}
              fallback={
                <div class="garden-inspector-empty">
                  <span aria-hidden="true">⌁</span>
                  <h2>Explore the garden</h2>
                  <p>Select a plant or vine to see the work that grew it.</p>
                </div>
              }
            >
              <Show when={selectedRecord()}>
                {(record) => (
                  <RecordDetails record={record()} snapshot={props.snapshot} />
                )}
              </Show>
              <Show when={selectedConnection()}>
                {(connection) => (
                  <ConnectionDetails
                    connection={connection()}
                    snapshot={props.snapshot}
                  />
                )}
              </Show>
            </Show>
          </aside>
        </div>
      </div>
    </section>
  )
}

function PlantButton(props: {
  record: GardenRecord
  selected: boolean
  select: () => void
}) {
  const variant = stableNumber(props.record.id) % 3
  return (
    <button
      type="button"
      class={plantClass(props.record, variant, props.selected)}
      data-garden-ref={recordKey(props.record)}
      data-label={props.record.label}
      aria-label={`${kindLabel(props.record.kind)}: ${props.record.label}${
        props.record.archived ? ', dormant' : ''
      }`}
      onClick={props.select}
    >
      <PlantArt record={props.record} />
      <span class="plant-tooltip">{props.record.label}</span>
    </button>
  )
}

function PlantArt(props: { record: GardenRecord }) {
  return (
    <svg class="plant-art" viewBox="0 0 90 100" aria-hidden="true">
      <Show when={props.record.kind === 'journal'}>
        <path class="stem" d="M45 90 C42 70 48 50 45 32" />
        <path class="leaf" d="M44 68 C27 58 24 72 42 78" />
        <path class="leaf leaf-right" d="M46 55 C64 43 67 59 48 66" />
        <circle class="petal flower-head" cx="45" cy="20" r="11" />
        <circle class="petal flower-head" cx="58" cy="29" r="11" />
        <circle class="petal flower-head" cx="53" cy="44" r="11" />
        <circle class="petal flower-head" cx="37" cy="44" r="11" />
        <circle class="petal flower-head" cx="32" cy="29" r="11" />
        <circle class="flower-center flower-head" cx="45" cy="32" r="9" />
      </Show>
      <Show when={props.record.kind === 'task'}>
        <path class="stem" d="M45 91 C44 72 45 52 45 32" />
        <path class="leaf" d="M44 67 C20 48 20 72 43 80" />
        <path class="leaf leaf-right" d="M46 59 C70 39 70 65 47 74" />
        <circle class="crop" cx="45" cy="33" r="17" />
        <path
          class="crop-top"
          d="M45 22 C37 9 29 18 39 27 M46 22 C54 9 64 19 51 28"
        />
      </Show>
      <Show when={props.record.kind === 'topic'}>
        <path
          class="trunk"
          d="M38 92 L41 57 L33 41 L45 54 L55 35 L50 59 L56 92 Z"
        />
        <circle class="canopy" cx="29" cy="42" r="22" />
        <circle class="canopy" cx="55" cy="31" r="27" />
        <circle class="canopy" cx="66" cy="54" r="20" />
        <circle class="canopy" cx="40" cy="58" r="24" />
        <circle class="fruit" cx="32" cy="42" r="4" />
        <circle class="fruit" cx="58" cy="29" r="4" />
        <circle class="fruit" cx="61" cy="56" r="4" />
      </Show>
    </svg>
  )
}

function RecordDetails(props: {
  record: GardenRecord
  snapshot: GardenSnapshot
}) {
  const links = () => linkedRecords(props.record, props.snapshot)
  return (
    <div>
      <p class="eyebrow">{kindLabel(props.record.kind)}</p>
      <h2>{props.record.label}</h2>
      <Show
        when={props.record.detail && props.record.detail !== props.record.label}
      >
        <p class="garden-detail-copy">{props.record.detail}</p>
      </Show>
      <dl class="garden-facts">
        <div>
          <dt>Planted</dt>
          <dd>{formatTime(props.record.createdAt)}</dd>
        </div>
        <div>
          <dt>State</dt>
          <dd>
            {props.record.archived ? 'Dormant' : growthLabel(props.record)}
          </dd>
        </div>
      </dl>
      <DetailList
        title="Growth"
        empty="No milestone growth yet."
        values={props.record.effects.map((effect) =>
          effectLabel(effect.reason),
        )}
      />
      <DetailList
        title="Linked work"
        empty="This plant is growing on its own."
        values={links().map((record) => record.label)}
      />
    </div>
  )
}

function ConnectionDetails(props: {
  connection: GardenConnection
  snapshot: GardenSnapshot
}) {
  const endpoints = () =>
    [props.connection.left, props.connection.right]
      .map((ref) => findRecord(ref, props.snapshot))
      .filter((record): record is GardenRecord => Boolean(record))
  return (
    <div>
      <p class="eyebrow">Connection vine</p>
      <h2>
        {endpoints()
          .map((record) => record.label)
          .join(' ↔ ')}
      </h2>
      <dl class="garden-facts">
        <div>
          <dt>Connected</dt>
          <dd>{formatTime(props.connection.connectedAt)}</dd>
        </div>
        <div>
          <dt>State</dt>
          <dd>
            {props.connection.archived
              ? 'Dormant'
              : hasEffect(props.connection, 'completed-task-connection')
                ? 'Flowering'
                : 'Growing'}
          </dd>
        </div>
      </dl>
      <DetailList
        title="Linked work"
        empty="Its endpoints are no longer visible."
        values={endpoints().map(
          (record) => `${kindLabel(record.kind)} · ${record.label}`,
        )}
      />
    </div>
  )
}

function DetailList(props: { title: string; empty: string; values: string[] }) {
  return (
    <section class="garden-detail-list">
      <h3>{props.title}</h3>
      <Show when={props.values.length} fallback={<p>{props.empty}</p>}>
        <ul>
          <For each={props.values}>{(value) => <li>{value}</li>}</For>
        </ul>
      </Show>
    </section>
  )
}

function linkedRecords(record: GardenRecord, snapshot: GardenSnapshot) {
  return snapshot.connections
    .filter(
      (connection) =>
        recordKey(connection.left) === recordKey(record) ||
        recordKey(connection.right) === recordKey(record),
    )
    .map((connection) =>
      recordKey(connection.left) === recordKey(record)
        ? connection.right
        : connection.left,
    )
    .map((ref) => findRecord(ref, snapshot))
    .filter((candidate): candidate is GardenRecord => Boolean(candidate))
}

function findRecord(
  ref: { kind: string; id: string },
  snapshot: GardenSnapshot,
) {
  return snapshot.records.find(
    (record) => record.kind === ref.kind && record.id === ref.id,
  )
}

function connectionLabel(
  connection: GardenConnection,
  snapshot: GardenSnapshot,
) {
  const left = findRecord(connection.left, snapshot)?.label ?? 'Missing record'
  const right =
    findRecord(connection.right, snapshot)?.label ?? 'Missing record'
  return `Connection: ${left} to ${right}${connection.archived ? ', dormant' : ''}`
}

function hasEffect(
  value: { effects: { reason: string }[] },
  reason: GardenEffectReason,
) {
  return value.effects.some((effect) => effect.reason === reason)
}

function plantClass(record: GardenRecord, variant: number, selected: boolean) {
  return [
    'garden-plant',
    record.kind,
    `variant-${variant}`,
    record.archived ? 'dormant' : '',
    selected ? 'selected' : '',
    hasEffect(record, 'task-first-completed') ? 'ripe' : '',
    hasEffect(record, 'topic-all-tasks-completed') ? 'fruiting' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function vineClass(connection: GardenConnection) {
  return [
    'garden-vine',
    hasEffect(connection, 'completed-task-connection') ? 'flowering' : '',
    connection.archived ? 'dormant' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function kindLabel(kind: GardenRecord['kind']) {
  if (kind === 'journal') return 'Journal flower'
  if (kind === 'task') return 'Task crop'
  return 'Topic tree'
}

function growthLabel(record: GardenRecord) {
  if (hasEffect(record, 'task-first-completed')) return 'Ripe'
  if (hasEffect(record, 'topic-all-tasks-completed')) return 'Fruiting'
  return 'Growing'
}

function effectLabel(reason: GardenEffectReason) {
  if (reason === 'task-first-completed') return 'Ripened after first completion'
  if (reason === 'completed-task-connection')
    return 'Flowered after its connected task completed'
  return 'Fruited after its topic milestone'
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value))
}
