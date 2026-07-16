import type { PersistedEvent } from '@specter-ts/core'

import type { InMemorySpecterObservability } from './recorder'
import type {
  OutboxAttemptSignal,
  ProjectionActivitySignal,
  ReactionRunSignal,
  RecordedSpecterOperationalSignal,
  SliceCursorSignal,
  SubscriptionInvalidatedSignal,
} from './signals'

export type SpecterDevelopmentPanelOptions = {
  readonly maxEvents?: number
  readonly maxActivity?: number
}

export type SpecterSubscriptionSummary = {
  readonly queryType: string
  readonly invalidationCount: number
  readonly lastReason?: string
  readonly lastObservedAt: Date
}

export type SpecterDevelopmentSnapshot = {
  readonly generatedAt: Date
  readonly eventLogVersion: number
  readonly events: readonly PersistedEvent[]
  readonly sliceCursors: readonly SliceCursorSignal[]
  readonly subscriptions: readonly SpecterSubscriptionSummary[]
  readonly reactions: readonly (ReactionRunSignal & {
    readonly sequence: number
    readonly observedAt: Date
  })[]
  readonly outbox: readonly (OutboxAttemptSignal & {
    readonly sequence: number
    readonly observedAt: Date
  })[]
  readonly projections: readonly (ProjectionActivitySignal & {
    readonly sequence: number
    readonly observedAt: Date
  })[]
}

export type SpecterDevelopmentPanel = {
  snapshot(): SpecterDevelopmentSnapshot
  renderJson(space?: number): string
  renderText(): string
  renderHtml(): string
  subscribe(
    listener: (snapshot: SpecterDevelopmentSnapshot) => void,
  ): () => void
}

function last<T>(items: readonly T[], count: number) {
  return items.slice(Math.max(0, items.length - count))
}

function escapeHtml(value: unknown) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function eventPayload(event: PersistedEvent) {
  try {
    return JSON.stringify(event.payload)
  } catch {
    return '[unserializable payload]'
  }
}

function renderTextSnapshot(state: SpecterDevelopmentSnapshot) {
  const lines = [
    'Specter development panel',
    `Event Log version: ${state.eventLogVersion}`,
    '',
    'Persisted Events:',
    ...state.events.map(
      (event) =>
        `  ${event.order} ${event.type} ${eventPayload(event) ?? 'undefined'}`,
    ),
    '',
    'Slice cursor lag:',
    ...state.sliceCursors.map(
      (cursor) =>
        `  ${cursor.sliceName}: cursor=${cursor.lastAppliedOrder} version=${cursor.eventLogVersion} lag=${cursor.lag}`,
    ),
    '',
    'Projection activity:',
    ...state.projections.map(
      (projection) =>
        `  ${projection.sliceName}: ${projection.activity} ${projection.outcome} ${projection.fromOrder}->${projection.toOrder ?? '-'}`,
    ),
    '',
    'Subscription invalidations:',
    ...state.subscriptions.map(
      (subscription) =>
        `  ${subscription.queryType}: ${subscription.invalidationCount}${subscription.lastReason ? ` (${subscription.lastReason})` : ''}`,
    ),
    '',
    'Reaction runs:',
    ...state.reactions.map(
      (reaction) =>
        `  ${reaction.reactionName ?? 'all'}: ${reaction.outcome}${reaction.error ? ` (${reaction.error})` : ''}`,
    ),
    '',
    'Outbox attempts:',
    ...state.outbox.map(
      (attempt) =>
        `  ${attempt.jobId} attempt=${attempt.attemptNumber}: ${attempt.outcome}${attempt.error ? ` (${attempt.error})` : ''}`,
    ),
  ]
  return lines.join('\n')
}

function aggregate(
  signals: readonly RecordedSpecterOperationalSignal[],
  options: Required<SpecterDevelopmentPanelOptions>,
): SpecterDevelopmentSnapshot {
  const events: PersistedEvent[] = []
  const cursorBySlice = new Map<string, SliceCursorSignal>()
  const projectionCursorBySlice = new Map<string, number>()
  const subscriptionByQuery = new Map<
    string,
    {
      count: number
      signal: SubscriptionInvalidatedSignal & {
        readonly observedAt: Date
      }
    }
  >()
  const reactions: SpecterDevelopmentSnapshot['reactions'][number][] = []
  const outbox: SpecterDevelopmentSnapshot['outbox'][number][] = []
  const projections: SpecterDevelopmentSnapshot['projections'][number][] = []
  let eventLogVersion = 0

  for (const signal of signals) {
    switch (signal.type) {
      case 'events.persisted':
        events.push(...signal.events)
        eventLogVersion = Math.max(eventLogVersion, signal.version)
        break
      case 'command.committed':
        eventLogVersion = Math.max(eventLogVersion, signal.version)
        break
      case 'slice.cursor':
        cursorBySlice.set(signal.sliceName, signal)
        eventLogVersion = Math.max(eventLogVersion, signal.eventLogVersion)
        break
      case 'subscription.invalidated': {
        const previous = subscriptionByQuery.get(signal.queryType)
        subscriptionByQuery.set(signal.queryType, {
          count: (previous?.count ?? 0) + 1,
          signal,
        })
        break
      }
      case 'reaction.run':
        reactions.push(signal)
        break
      case 'outbox.attempt':
        outbox.push(signal)
        break
      case 'projection.activity':
        projections.push(signal)
        if (signal.outcome === 'completed' && signal.toOrder !== undefined) {
          projectionCursorBySlice.set(signal.sliceName, signal.toOrder)
        }
        break
    }
  }

  for (const [sliceName, lastAppliedOrder] of projectionCursorBySlice) {
    if (cursorBySlice.has(sliceName)) continue
    cursorBySlice.set(sliceName, {
      type: 'slice.cursor',
      sliceName,
      lastAppliedOrder,
      eventLogVersion,
      lag: Math.max(0, eventLogVersion - lastAppliedOrder),
    })
  }

  return {
    generatedAt: new Date(),
    eventLogVersion,
    events: last(events, options.maxEvents).map((event) => ({ ...event })),
    sliceCursors: [...cursorBySlice.values()]
      .map((cursor) => ({
        ...cursor,
        eventLogVersion,
        lag: Math.max(0, eventLogVersion - cursor.lastAppliedOrder),
      }))
      .sort((left, right) => left.sliceName.localeCompare(right.sliceName)),
    subscriptions: [...subscriptionByQuery.entries()]
      .map(([queryType, entry]) => ({
        queryType,
        invalidationCount: entry.count,
        lastReason: entry.signal.reason,
        lastObservedAt: entry.signal.observedAt,
      }))
      .sort((left, right) => left.queryType.localeCompare(right.queryType)),
    reactions: last(reactions, options.maxActivity),
    outbox: last(outbox, options.maxActivity),
    projections: last(projections, options.maxActivity),
  }
}

export function createSpecterDevelopmentPanel(
  source: InMemorySpecterObservability,
  options: SpecterDevelopmentPanelOptions = {},
): SpecterDevelopmentPanel {
  const resolvedOptions = {
    maxEvents: options.maxEvents ?? 100,
    maxActivity: options.maxActivity ?? 100,
  }

  function snapshot() {
    return aggregate(source.snapshot(), resolvedOptions)
  }

  return {
    snapshot,
    subscribe(listener) {
      return source.subscribe(() => listener(snapshot()))
    },
    renderJson(space = 2) {
      return JSON.stringify(snapshot(), null, space)
    },
    renderText() {
      return renderTextSnapshot(snapshot())
    },
    renderHtml() {
      const state = snapshot()
      const eventRows = state.events
        .map(
          (event) =>
            `<tr><td>${event.order}</td><td>${escapeHtml(event.type)}</td><td><code>${escapeHtml(eventPayload(event))}</code></td></tr>`,
        )
        .join('')
      const cursorRows = state.sliceCursors
        .map(
          (cursor) =>
            `<tr><td>${escapeHtml(cursor.sliceName)}</td><td>${cursor.lastAppliedOrder}</td><td>${cursor.eventLogVersion}</td><td>${cursor.lag}</td></tr>`,
        )
        .join('')
      const reactionRows = state.reactions
        .map(
          (reaction) =>
            `<tr><td>${escapeHtml(reaction.reactionName ?? 'all')}</td><td>${reaction.outcome}</td><td>${escapeHtml(reaction.error ?? '')}</td></tr>`,
        )
        .join('')
      const outboxRows = state.outbox
        .map(
          (attempt) =>
            `<tr><td>${escapeHtml(attempt.jobId)}</td><td>${attempt.attemptNumber}</td><td>${attempt.outcome}</td><td>${escapeHtml(attempt.error ?? '')}</td></tr>`,
        )
        .join('')
      const projectionRows = state.projections
        .map(
          (projection) =>
            `<tr><td>${escapeHtml(projection.sliceName)}</td><td>${projection.activity}</td><td>${projection.outcome}</td><td>${projection.fromOrder} → ${projection.toOrder ?? '—'}</td></tr>`,
        )
        .join('')
      const subscriptionRows = state.subscriptions
        .map(
          (subscription) =>
            `<tr><td>${escapeHtml(subscription.queryType)}</td><td>${subscription.invalidationCount}</td><td>${escapeHtml(subscription.lastReason ?? '')}</td></tr>`,
        )
        .join('')

      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Specter development panel</title><style>body{font:14px/1.4 system-ui;margin:2rem;color:#18212f;background:#f6f8fb}h1{margin:0 0 .25rem}h2{margin-top:2rem}table{width:100%;border-collapse:collapse;background:white}th,td{padding:.55rem;text-align:left;border:1px solid #d8dee9;vertical-align:top}code{white-space:pre-wrap;overflow-wrap:anywhere}.meta{color:#5b6574}</style></head><body><main><h1>Specter development panel</h1><p class="meta">Event Log version ${state.eventLogVersion}; generated ${state.generatedAt.toISOString()}</p><h2>Persisted Events</h2><table><thead><tr><th>Order</th><th>Type</th><th>Payload</th></tr></thead><tbody>${eventRows}</tbody></table><h2>Slice cursor lag</h2><table><thead><tr><th>Slice</th><th>Cursor</th><th>Version</th><th>Lag</th></tr></thead><tbody>${cursorRows}</tbody></table><h2>Projection replay and catch-up</h2><table><thead><tr><th>Slice</th><th>Activity</th><th>Outcome</th><th>Orders</th></tr></thead><tbody>${projectionRows}</tbody></table><h2>Subscription invalidations</h2><table><thead><tr><th>Query</th><th>Count</th><th>Reason</th></tr></thead><tbody>${subscriptionRows}</tbody></table><h2>Reaction runs</h2><table><thead><tr><th>Reaction</th><th>Outcome</th><th>Error</th></tr></thead><tbody>${reactionRows}</tbody></table><h2>Outbox attempts</h2><table><thead><tr><th>Job</th><th>Attempt</th><th>Outcome</th><th>Error</th></tr></thead><tbody>${outboxRows}</tbody></table></main></body></html>`
    },
  }
}
