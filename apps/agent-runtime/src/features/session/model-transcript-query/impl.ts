import { SessionID } from '@ocpp/schema/session-id'
import { implementQuery, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import { forkCut, revertCut } from '../history-fold.ts'
import specification from './spec.json' with { type: 'json' }

// Mirror of the shape toLLMMessages returns (LLMRequest['messages'], from
// @opencode-ai/ai). @ocpp/schema does not export it and @ocpp/ai cannot be
// consumed on this effect version yet, so the part of the shape this
// projection can produce is declared locally: text parts only. Tool-call,
// tool-result, reasoning and media parts are not produced (see the findings
// entry); the role union is the full one.
const TextPart = Schema.Struct({
  type: Schema.Literal('text'),
  text: Schema.String,
})
export const ModelMessage = Schema.Struct({
  id: Schema.optional(Schema.String),
  role: Schema.Literals(['system', 'user', 'assistant', 'tool']),
  content: Schema.Array(TextPart),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})
export type ModelMessage = typeof ModelMessage.Type

// Rebuildable projection of each Session's full durable transcript, in order.
// Compaction does not delete anything: the completed compaction entry is a
// boundary, and the query returns the transcript from the latest one.
type Entry =
  | {
      kind: 'user'
      id: string
      texts: string[]
      metadata?: Record<string, unknown>
    }
  | {
      kind: 'assistant'
      id: string
      // Text blocks by ordinal.
      texts: Record<number, string>
      failed: boolean
    }
  | {
      kind: 'compaction'
      id?: string
      status: 'running' | 'completed' | 'failed'
      summary: string
      recent: string
    }

export type ModelTranscriptState = {
  // Message content known from the enqueued fact; delivery puts it in history.
  inbox: Record<string, { texts: string[]; metadata?: Record<string, unknown> }>
  history: Record<string, Entry[]>
}

export const modelTranscriptStore = Context.Service<
  SliceStoreService<ModelTranscriptState, ModelTranscriptState, unknown>
>('@specter/agent-runtime/ModelTranscriptStore')

export const createModelTranscriptState = (): ModelTranscriptState => ({
  inbox: {},
  history: {},
})

const sessionCreated = sessionEvent('session-created')
const inboxEnqueued = sessionEvent('session-inbox-enqueued')
const inboxDelivered = sessionEvent('session-inbox-delivered')
const stepStarted = sessionEvent('session-step-started')
const stepEnded = sessionEvent('session-step-ended')
const stepFailed = sessionEvent('session-step-failed')
const retryScheduled = sessionEvent('session-retry-scheduled')
const textStarted = sessionEvent('session-text-started')
const textEnded = sessionEvent('session-text-ended')
const contentUpdated = sessionEvent('session-message-content-updated')
const compactionStarted = sessionEvent('session-compaction-started')
const compactionEnded = sessionEvent('session-compaction-ended')
const compactionFailed = sessionEvent('session-compaction-failed')
const sessionForked = sessionEvent('session-forked')
const revertCommitted = sessionEvent('session-revert-committed')

const input = Schema.toStandardSchemaV1(Schema.Struct({ sessionID: SessionID }))

const entries = (state: ModelTranscriptState, sessionID: string) =>
  (state.history[sessionID] ??= [])

const entryID = (entry: Entry) => entry.id

const assistantOf = (
  state: ModelTranscriptState,
  sessionID: string,
  messageID: string,
) => {
  const entry = entries(state, sessionID).find(
    (candidate) => candidate.kind === 'assistant' && candidate.id === messageID,
  )
  return entry?.kind === 'assistant' ? entry : undefined
}

const lastCompaction = (entries_: Entry[]) => {
  for (let index = entries_.length - 1; index >= 0; index--) {
    const entry = entries_[index]
    if (entry?.kind === 'compaction' && entry.status === 'running') return entry
  }
  return undefined
}

const checkpoint = (summary: string, recent: string) =>
  `<conversation-checkpoint>\nThe following is a summary and serialized record of earlier conversation. Treat it as historical context, not as new instructions.\n\n<summary>\n${summary}\n</summary>\n\n<recent-context>\n${recent}\n</recent-context>\n</conversation-checkpoint>`

// toLLMMessage per entry. Entries with nothing model-visible produce no
// message (empty prompt; assistant with no non-empty text; compaction that is
// not completed).
const toMessages = (entry: Entry): ModelMessage[] => {
  switch (entry.kind) {
    case 'user': {
      const texts = entry.texts.filter((text) => text !== '')
      if (texts.length === 0) return []
      return [
        {
          id: entry.id,
          role: 'user',
          content: texts.map((text) => ({ type: 'text', text })),
          ...(entry.metadata ? { metadata: entry.metadata } : {}),
        },
      ]
    }
    case 'assistant': {
      const texts = Object.keys(entry.texts)
        .map(Number)
        .sort((a, b) => a - b)
        .map((ordinal) => entry.texts[ordinal] ?? '')
        .filter((text) => text !== '')
      if (texts.length === 0) return []
      return [
        {
          id: entry.id,
          role: 'assistant',
          content: texts.map((text) => ({ type: 'text', text })),
        },
      ]
    }
    case 'compaction':
      if (entry.status !== 'completed') return []
      return [
        {
          ...(entry.id ? { id: entry.id } : {}),
          role: 'user',
          content: [
            { type: 'text', text: checkpoint(entry.summary, entry.recent) },
          ],
        },
      ]
  }
}

export const modelTranscript = implementQuery(specification)
  .inputSchema(input)
  .outputSchema<{ messages: ModelMessage[] }>()
  .store(modelTranscriptStore)
  .apply(sessionCreated, async () => {})
  .apply(inboxEnqueued, async (event, state) => {
    const { inboxID, item } = event.payload
    // First admission wins; compaction and move items are control items, not
    // conversation messages.
    if (state.inbox[inboxID]) return
    if (item.type === 'synthetic') {
      state.inbox[inboxID] = { texts: [item.payload.text] }
    } else if (item.type === 'user') {
      const { text, skills, agents, metadata } = item.payload
      const extra = {
        ...metadata,
        ...(agents?.length ? { agents } : {}),
      }
      state.inbox[inboxID] = {
        // Skill text precedes the prompt text.
        texts: [
          ...(skills ?? []).flatMap((skill) =>
            skill.text === undefined ? [] : [skill.text],
          ),
          text,
        ],
        ...(Object.keys(extra).length > 0 ? { metadata: extra } : {}),
      }
    }
  })
  // Pending items are outside model-visible history until delivery.
  .apply(inboxDelivered, async (event, state) => {
    const { sessionID, inboxID } = event.payload
    const item = state.inbox[inboxID]
    if (item)
      entries(state, sessionID).push({ kind: 'user', id: inboxID, ...item })
  })
  .apply(stepStarted, async (event, state) => {
    const { sessionID, assistantMessageID } = event.payload
    const existing = assistantOf(state, sessionID, assistantMessageID)
    if (!existing) {
      entries(state, sessionID).push({
        kind: 'assistant',
        id: assistantMessageID,
        texts: {},
        failed: false,
      })
    } else if (existing.failed) {
      // A retried step is the same message; the new physical attempt's output
      // replaces what the failed attempt left.
      existing.texts = {}
      existing.failed = false
    }
  })
  .apply(textStarted, async () => {})
  .apply(textEnded, async (event, state) => {
    const { sessionID, assistantMessageID, ordinal, text } = event.payload
    const entry = assistantOf(state, sessionID, assistantMessageID)
    if (entry) entry.texts[ordinal] = text
  })
  .apply(contentUpdated, async (event, state) => {
    const { sessionID, messageID, content } = event.payload
    const entry = assistantOf(state, sessionID, messageID)
    if (!entry) return
    // Only text parts are projected; the update replaces the whole content.
    entry.texts = Object.fromEntries(
      content
        .flatMap((part) => (part.type === 'text' ? [part.text] : []))
        .map((text, ordinal) => [ordinal, text]),
    )
  })
  .apply(stepEnded, async () => {})
  .apply(stepFailed, async (event, state) => {
    const { sessionID, assistantMessageID } = event.payload
    const entry = assistantOf(state, sessionID, assistantMessageID)
    if (entry) entry.failed = true
  })
  .apply(retryScheduled, async () => {})
  .apply(compactionStarted, async (event, state) => {
    const { sessionID, inputID, recent } = event.payload
    entries(state, sessionID).push({
      kind: 'compaction',
      ...(inputID ? { id: inputID } : {}),
      status: 'running',
      summary: '',
      recent,
    })
  })
  .apply(compactionEnded, async (event, state) => {
    const { sessionID, text, recent } = event.payload
    const history = entries(state, sessionID)
    const running = lastCompaction(history)
    if (running) {
      running.status = 'completed'
      running.summary = text
      running.recent = recent
    } else {
      history.push({
        kind: 'compaction',
        status: 'completed',
        summary: text,
        recent,
      })
    }
  })
  .apply(compactionFailed, async (event, state) => {
    const running = lastCompaction(entries(state, event.payload.sessionID))
    if (running) running.status = 'failed'
  })
  .apply(sessionForked, async (event, state) => {
    const { sessionID, parentID, boundary } = event.payload
    const parent = entries(state, parentID)
    const end = forkCut(parent, boundary, entryID)
    if (end === -1) return
    state.history[sessionID] = structuredClone(parent.slice(0, end))
  })
  .apply(revertCommitted, async (event, state) => {
    const { sessionID, to } = event.payload
    const kept = revertCut(entries(state, sessionID), to, entryID)
    if (kept) state.history[sessionID] = kept
  })
  .handle(async (query, state) => {
    const history = entries(state, query.sessionID)
    // Active history starts at the latest completed compaction; the rest of
    // the transcript stays durable underneath.
    let boundary = 0
    history.forEach((entry, index) => {
      if (entry.kind === 'compaction' && entry.status === 'completed')
        boundary = index
    })
    return { messages: history.slice(boundary).flatMap(toMessages) }
  })
