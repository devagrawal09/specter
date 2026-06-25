import { createClient, type Client } from '@libsql/client/sqlite3'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  prepareSpecterSqlite,
  runWithSqliteDb,
  setSpecterSqliteEventProjector,
  sqliteEventLog,
} from '../../db/specter-sqlite'
import { projectSpecterCodeEvent } from './adapters/read-models'
import {
  sessionCreatedEvent,
  sessionDeletedEvent,
  sessionUpdatedEvent,
  toolApprovalRepliedEvent,
  toolApprovalRequestedEvent,
  userMessageSubmittedEvent,
} from './events'

let tempDir: string
let db: Client

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'specter-code-read-models-'))
  db = createClient({ url: `file:${join(tempDir, 'specter-code.db')}` })
  await prepareSpecterSqlite(db)
  setSpecterSqliteEventProjector(projectSpecterCodeEvent)
})

afterEach(async () => {
  setSpecterSqliteEventProjector(undefined)
  db.close()
  await rm(tempDir, { recursive: true, force: true })
})

describe('Specter Code table-backed read model projection', () => {
  it('projects durable sessions, user messages, and approval decisions from appended events', async () => {
    await runWithSqliteDb(db, async () => {
      await sqliteEventLog.append([
        sessionCreatedEvent.create({
          sessionId: 'session-read-model-1',
          workspaceId: 'workspace-read-model-1',
          title: 'Read model session',
          directory: '.',
          agent: 'build',
          model: {
            providerId: 'openrouter',
            modelId: 'anthropic/claude-sonnet-4',
          },
          createdBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
        }),
        sessionUpdatedEvent.create({
          sessionId: 'session-read-model-1',
          title: 'Renamed read model session',
          agent: 'senior',
          model: { providerId: 'anthropic', modelId: 'claude-opus-4.1' },
        }),
        sessionDeletedEvent.create({ sessionId: 'session-read-model-1' }),
        userMessageSubmittedEvent.create({
          messageId: 'message-read-model-1',
          sessionId: 'session-read-model-1',
          workspaceId: 'workspace-read-model-1',
          content: 'Please inspect the repository',
          submittedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
        }),
        toolApprovalRequestedEvent.create({
          requestId: 'approval-read-model-1',
          sessionId: 'session-read-model-1',
          messageId: 'message-read-model-1',
          workspaceId: 'workspace-read-model-1',
          agentId: 'build',
          toolCallId: 'tool-call-read-model-1',
          toolName: 'shell',
          permission: 'shell.execute',
          target: 'pnpm test',
          reason: 'Shell commands require confirmation',
        }),
        toolApprovalRepliedEvent.create({
          requestId: 'approval-read-model-1',
          sessionId: 'session-read-model-1',
          action: 'allow',
          repliedBy: { userId: 'user-1', displayName: 'Ada Lovelace' },
        }),
      ])
    })

    const sessionRows = await db.execute({
      sql: 'SELECT id, workspace_id, title, agent_id, provider_id, model_id, status FROM specter_code_sessions',
      args: [],
    })
    expect(sessionRows.rows).toEqual([
      {
        id: 'session-read-model-1',
        workspace_id: 'workspace-read-model-1',
        title: 'Renamed read model session',
        agent_id: 'senior',
        provider_id: 'anthropic',
        model_id: 'claude-opus-4.1',
        status: 'deleted',
      },
    ])

    const messageRows = await db.execute({
      sql: 'SELECT id, session_id, role, author_json, content, event_order FROM specter_code_messages',
      args: [],
    })
    expect(messageRows.rows).toEqual([
      {
        id: 'message-read-model-1',
        session_id: 'session-read-model-1',
        role: 'user',
        author_json: JSON.stringify({
          userId: 'user-1',
          displayName: 'Ada Lovelace',
        }),
        content: 'Please inspect the repository',
        event_order: 4,
      },
    ])

    const permissionRows = await db.execute({
      sql: 'SELECT request_id, session_id, message_id, tool_call_id, tool_name, permission, target, action, status, reason, replied_by_json FROM specter_code_permissions',
      args: [],
    })
    expect(permissionRows.rows).toEqual([
      {
        request_id: 'approval-read-model-1',
        session_id: 'session-read-model-1',
        message_id: 'message-read-model-1',
        tool_call_id: null,
        tool_name: 'shell',
        permission: 'shell.execute',
        target: 'pnpm test',
        action: 'allow',
        status: 'resolved',
        reason: 'Shell commands require confirmation',
        replied_by_json: JSON.stringify({
          userId: 'user-1',
          displayName: 'Ada Lovelace',
        }),
      },
    ])
  })
})
