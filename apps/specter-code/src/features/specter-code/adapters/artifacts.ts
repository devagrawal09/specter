import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { getBoundSqliteDb } from '../../../db/specter-sqlite.ts'

export type FileArtifactStore = {
  rootDir: string
}

export type SpecterCodeArtifact = {
  id: string
  sessionId: string
  messageId?: string
  type: 'tool_output'
  title: string
  path: string
  toolName: string
  sizeBytes: number
  preview: string
  createdAt: string
  eventOrder: number
}

export type ToolOutputArtifactInput = {
  sessionId: string
  messageId?: string
  toolName: string
  title: string
  content: string
  maxInlineBytes: number
  createdAt?: string
  eventOrder?: number
}

export type ToolOutputArtifactResult = {
  inlineContent: string
  truncated: boolean
  artifact?: SpecterCodeArtifact
}

type ArtifactMetadata = {
  toolName: string
  sizeBytes: number
  preview: string
}

export function createFileArtifactStore(input: {
  rootDir: string
}): FileArtifactStore {
  const rootDir = path.resolve(input.rootDir)
  return { rootDir }
}

export async function writeToolOutputArtifact(
  store: FileArtifactStore,
  input: ToolOutputArtifactInput,
): Promise<ToolOutputArtifactResult> {
  const maxInlineBytes = normalizeByteLimit(input.maxInlineBytes)
  const contentBytes = Buffer.from(input.content, 'utf8')
  const inlineContent = contentBytes
    .subarray(0, maxInlineBytes)
    .toString('utf8')

  if (contentBytes.byteLength <= maxInlineBytes) {
    return {
      inlineContent: input.content,
      truncated: false,
      artifact: undefined,
    }
  }

  const artifactId = 'artifact-' + randomUUID()
  const relativePath = path.posix.join(
    sanitizePathSegment(input.sessionId, 'sessionId'),
    'artifacts',
    artifactId + '.txt',
  )
  const absolutePath = resolveArtifactPath(store, relativePath)
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, input.content, 'utf8')

  const createdAt = input.createdAt ?? new Date().toISOString()
  const eventOrder = input.eventOrder ?? 0
  const artifact: SpecterCodeArtifact = {
    id: artifactId,
    sessionId: input.sessionId,
    messageId: input.messageId,
    type: 'tool_output',
    title: input.title,
    path: relativePath,
    toolName: input.toolName,
    sizeBytes: contentBytes.byteLength,
    preview: inlineContent,
    createdAt,
    eventOrder,
  }
  const metadata: ArtifactMetadata = {
    toolName: artifact.toolName,
    sizeBytes: artifact.sizeBytes,
    preview: artifact.preview,
  }

  await getBoundSqliteDb().execute({
    sql: `
      INSERT INTO specter_code_artifacts (
        id,
        session_id,
        message_id,
        type,
        title,
        path,
        content_json,
        created_at,
        event_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      artifact.id,
      artifact.sessionId,
      artifact.messageId ?? null,
      artifact.type,
      artifact.title,
      artifact.path,
      JSON.stringify(metadata),
      artifact.createdAt,
      artifact.eventOrder,
    ],
  })

  return { inlineContent, truncated: true, artifact }
}

export async function listSessionArtifacts(input: {
  sessionId: string
}): Promise<SpecterCodeArtifact[]> {
  const result = await getBoundSqliteDb().execute({
    sql: `
      SELECT
        id,
        session_id,
        message_id,
        type,
        title,
        path,
        content_json,
        created_at,
        event_order
      FROM specter_code_artifacts
      WHERE session_id = ?
      ORDER BY created_at ASC, id ASC
    `,
    args: [input.sessionId],
  })

  return result.rows.map((row) => {
    const metadata = parseMetadata(String(row.content_json ?? '{}'))
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      messageId: row.message_id === null ? undefined : String(row.message_id),
      type: 'tool_output',
      title: String(row.title),
      path: String(row.path),
      toolName: metadata.toolName,
      sizeBytes: metadata.sizeBytes,
      preview: metadata.preview,
      createdAt: String(row.created_at),
      eventOrder: Number(row.event_order),
    }
  })
}

export async function readArtifactContent(
  store: FileArtifactStore,
  artifactPath: string,
) {
  return readFile(resolveArtifactPath(store, artifactPath), 'utf8')
}

function normalizeByteLimit(value: number) {
  if (!Number.isFinite(value) || value < 1) {
    throw new Error('Artifact inline byte limit must be positive')
  }
  return Math.floor(value)
}

function sanitizePathSegment(value: string, field: string) {
  const sanitized = value.trim().replace(/[^A-Za-z0-9._-]/g, '_')
  if (!sanitized) throw new Error('Artifact ' + field + ' is required')
  return sanitized
}

function resolveArtifactPath(store: FileArtifactStore, relativePath: string) {
  const normalized = relativePath.replaceAll('\\', '/')
  if (
    path.posix.isAbsolute(normalized) ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  ) {
    throw new Error('Artifact path escapes the artifact root')
  }

  const root = path.resolve(store.rootDir)
  const absolutePath = path.resolve(root, ...normalized.split('/'))
  if (absolutePath !== root && !absolutePath.startsWith(root + path.sep)) {
    throw new Error('Artifact path escapes the artifact root')
  }
  return absolutePath
}

function parseMetadata(raw: string): ArtifactMetadata {
  const parsed = JSON.parse(raw) as Partial<ArtifactMetadata>
  return {
    toolName: typeof parsed.toolName === 'string' ? parsed.toolName : 'unknown',
    sizeBytes: typeof parsed.sizeBytes === 'number' ? parsed.sizeBytes : 0,
    preview: typeof parsed.preview === 'string' ? parsed.preview : '',
  }
}
