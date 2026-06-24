import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { runWithSpecterCodeReferenceDb } from '../../../db/client.server.ts'
import { querySpecterSqliteEvents, sqliteEventLog } from '../../../db/specter-sqlite.ts'

export const SPECTER_CODE_SESSION_EXPORT_FORMAT = 'specter-code.session.v1' as const

export type SpecterCodeSessionEvent = {
  type: string
  payload: Record<string, unknown>
}

export type SpecterCodeSessionExport = {
  format: typeof SPECTER_CODE_SESSION_EXPORT_FORMAT
  exportedAt: string
  session: {
    sessionId: string
    workspaceId: string
    title: string
    directory: string
    agent: string
    model: {
      providerId: string
      modelId: string
    }
  }
  events: SpecterCodeSessionEvent[]
}

export function buildSpecterCodeSessionExport(input: {
  sessionId: string
  events: readonly SpecterCodeSessionEvent[]
  exportedAt?: string
}): SpecterCodeSessionExport {
  const sessionEvent = input.events.find(
    (event) => event.type === 'sessionCreated' && event.payload.sessionId === input.sessionId,
  )
  if (!sessionEvent) throw new Error(`Cannot export unknown session: ${input.sessionId}`)

  const session = sessionFromPayload(sessionEvent.payload)
  const included = selectSessionEventIndexes(input.events, session)
  const events = input.events.filter((_, index) => included.has(index)).map(cloneEvent)

  return {
    format: SPECTER_CODE_SESSION_EXPORT_FORMAT,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    session,
    events,
  }
}

export function normalizeSpecterCodeSessionExport(input: unknown): SpecterCodeSessionExport {
  if (!isRecord(input) || input.format !== SPECTER_CODE_SESSION_EXPORT_FORMAT) {
    throw new Error('Unsupported Specter Code session export format')
  }
  if (typeof input.exportedAt !== 'string') throw new Error('Session export timestamp is required')
  if (!isRecord(input.session)) throw new Error('Session export metadata is required')
  if (!Array.isArray(input.events)) throw new Error('Session export events are required')

  const session = sessionFromPayload(input.session)
  const events = input.events.map((event, index) => {
    if (!isRecord(event) || typeof event.type !== 'string' || !isRecord(event.payload)) {
      throw new Error(`Invalid session export event at index ${index}`)
    }
    return { type: event.type, payload: { ...event.payload } }
  })

  const hasSessionCreated = events.some(
    (event) => event.type === 'sessionCreated' && event.payload.sessionId === session.sessionId,
  )
  if (!hasSessionCreated) throw new Error('Session export must include its sessionCreated event')

  return {
    format: SPECTER_CODE_SESSION_EXPORT_FORMAT,
    exportedAt: input.exportedAt,
    session,
    events,
  }
}

export async function exportSpecterCodeSessionFile(input: {
  sessionId: string
  outputPath: string
}) {
  const events = await runWithSpecterCodeReferenceDb(async () => queryAllSpecterCodeEvents())
  const exported = buildSpecterCodeSessionExport({ sessionId: input.sessionId, events })
  await mkdir(path.dirname(input.outputPath), { recursive: true })
  await writeFile(input.outputPath, `${JSON.stringify(exported, null, 2)}\n`, 'utf8')
  return {
    sessionId: exported.session.sessionId,
    eventCount: exported.events.length,
    outputPath: input.outputPath,
  }
}

export async function importSpecterCodeSessionFile(input: { inputPath: string }) {
  const parsed = JSON.parse(await readFile(input.inputPath, 'utf8')) as unknown
  const exported = normalizeSpecterCodeSessionExport(parsed)

  await runWithSpecterCodeReferenceDb(async () => {
    await sqliteEventLog.append(exported.events.map((event) => ({ type: event.type, payload: event.payload })))
  })

  return {
    sessionId: exported.session.sessionId,
    eventCount: exported.events.length,
  }
}

async function queryAllSpecterCodeEvents() {
  const events: SpecterCodeSessionEvent[] = []
  let afterOrder = 0

  while (true) {
    const page = await querySpecterSqliteEvents({ afterOrder, limit: 500 })
    for (const event of page) {
      if (isRecord(event.payload)) events.push({ type: event.type, payload: { ...event.payload } })
      afterOrder = event.order
    }
    if (page.length < 500) return events
  }
}

function selectSessionEventIndexes(
  events: readonly SpecterCodeSessionEvent[],
  session: SpecterCodeSessionExport['session'],
) {
  const included = new Set<number>()
  const messageIds = new Set<string>()
  const runIds = new Set<string>()
  const toolCallIds = new Set<string>()
  const ptySessionIds = new Set<string>()

  let changed = true
  while (changed) {
    changed = false
    events.forEach((event, index) => {
      if (included.has(index)) return
      if (!isSessionRelatedEvent(event, session, messageIds, runIds, toolCallIds, ptySessionIds)) return

      included.add(index)
      collectIdentifiers(event.payload, messageIds, runIds, toolCallIds, ptySessionIds)
      changed = true
    })
  }

  return included
}

function isSessionRelatedEvent(
  event: SpecterCodeSessionEvent,
  session: SpecterCodeSessionExport['session'],
  messageIds: ReadonlySet<string>,
  runIds: ReadonlySet<string>,
  toolCallIds: ReadonlySet<string>,
  ptySessionIds: ReadonlySet<string>,
) {
  const payload = event.payload
  if (event.type === 'workspaceCreated' && payload.workspaceId === session.workspaceId) return true
  if (payload.sessionId === session.sessionId) return true
  if (payload.messageId && messageIds.has(String(payload.messageId))) return true
  if (payload.parentPostId && messageIds.has(String(payload.parentPostId))) return true
  if (payload.postId && messageIds.has(String(payload.postId))) return true
  if (payload.runId && runIds.has(String(payload.runId))) return true
  if (payload.sourceRunId && runIds.has(String(payload.sourceRunId))) return true
  if (payload.toolCallId && toolCallIds.has(String(payload.toolCallId))) return true
  if (payload.ptySessionId && ptySessionIds.has(String(payload.ptySessionId))) return true
  return false
}

function collectIdentifiers(
  payload: Record<string, unknown>,
  messageIds: Set<string>,
  runIds: Set<string>,
  toolCallIds: Set<string>,
  ptySessionIds: Set<string>,
) {
  addString(messageIds, payload.messageId)
  addString(messageIds, payload.postId)
  addString(messageIds, payload.parentPostId)
  addString(messageIds, payload.replyId)
  addString(runIds, payload.runId)
  addString(runIds, payload.sourceRunId)
  addString(toolCallIds, payload.toolCallId)
  addString(ptySessionIds, payload.ptySessionId)
}

function addString(values: Set<string>, value: unknown) {
  if (typeof value === 'string' && value) values.add(value)
}

function sessionFromPayload(payload: Record<string, unknown>): SpecterCodeSessionExport['session'] {
  const model = payload.model
  if (!isRecord(model)) throw new Error('Session export model is required')
  return {
    sessionId: requireString(payload.sessionId, 'sessionId'),
    workspaceId: requireString(payload.workspaceId, 'workspaceId'),
    title: requireString(payload.title, 'title'),
    directory: requireString(payload.directory, 'directory'),
    agent: requireString(payload.agent, 'agent'),
    model: {
      providerId: requireString(model.providerId, 'model.providerId'),
      modelId: requireString(model.modelId, 'model.modelId'),
    },
  }
}

function requireString(value: unknown, field: string) {
  if (typeof value !== 'string' || !value) throw new Error(`Session export ${field} is required`)
  return value
}

function cloneEvent(event: SpecterCodeSessionEvent): SpecterCodeSessionEvent {
  return { type: event.type, payload: { ...event.payload } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
