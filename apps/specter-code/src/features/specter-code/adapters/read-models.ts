import type {
  SqliteDb,
  SpecterSqliteEventRecord,
} from '../../../db/specter-sqlite'
import {
  sessionCreatedEvent,
  sessionDeletedEvent,
  sessionUpdatedEvent,
  toolApprovalRepliedEvent,
  toolApprovalRequestedEvent,
  userMessageSubmittedEvent,
} from '../events'

export async function projectSpecterCodeEvent(
  db: SqliteDb,
  event: SpecterSqliteEventRecord,
) {
  if (event.type === sessionCreatedEvent.type) {
    const payload = await sessionCreatedEvent.decode(event.payload)
    await db.execute({
      sql: `
        INSERT INTO specter_code_sessions (
          id,
          workspace_id,
          title,
          directory,
          agent_id,
          provider_id,
          model_id,
          status,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          workspace_id = excluded.workspace_id,
          title = excluded.title,
          directory = excluded.directory,
          agent_id = excluded.agent_id,
          provider_id = excluded.provider_id,
          model_id = excluded.model_id,
          updated_at = excluded.updated_at
      `,
      args: [
        payload.sessionId,
        payload.workspaceId,
        payload.title,
        payload.directory,
        payload.agent,
        payload.model.providerId,
        payload.model.modelId,
        event.recordedAt,
        event.recordedAt,
      ],
    })
    return
  }

  if (event.type === sessionUpdatedEvent.type) {
    const payload = await sessionUpdatedEvent.decode(event.payload)
    await db.execute({
      sql: `
        UPDATE specter_code_sessions
        SET title = COALESCE(?, title),
            directory = COALESCE(?, directory),
            agent_id = COALESCE(?, agent_id),
            provider_id = COALESCE(?, provider_id),
            model_id = COALESCE(?, model_id),
            updated_at = ?
        WHERE id = ?
      `,
      args: [
        payload.title ?? null,
        payload.directory ?? null,
        payload.agent ?? null,
        payload.model?.providerId ?? null,
        payload.model?.modelId ?? null,
        event.recordedAt,
        payload.sessionId,
      ],
    })
    return
  }

  if (event.type === sessionDeletedEvent.type) {
    const payload = await sessionDeletedEvent.decode(event.payload)
    await db.execute({
      sql: `
        UPDATE specter_code_sessions
        SET status = 'deleted',
            updated_at = ?
        WHERE id = ?
      `,
      args: [event.recordedAt, payload.sessionId],
    })
    return
  }

  if (event.type === userMessageSubmittedEvent.type) {
    const payload = await userMessageSubmittedEvent.decode(event.payload)
    await db.execute({
      sql: `
        INSERT INTO specter_code_messages (
          id,
          session_id,
          role,
          author_json,
          content,
          created_at,
          event_order
        ) VALUES (?, ?, 'user', ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          session_id = excluded.session_id,
          author_json = excluded.author_json,
          content = excluded.content,
          event_order = excluded.event_order
      `,
      args: [
        payload.messageId,
        payload.sessionId,
        JSON.stringify(payload.submittedBy),
        payload.content,
        event.recordedAt,
        event.order,
      ],
    })
    await db.execute({
      sql: `
        UPDATE specter_code_sessions
        SET updated_at = ?
        WHERE id = ?
      `,
      args: [event.recordedAt, payload.sessionId],
    })
    return
  }

  if (event.type === toolApprovalRequestedEvent.type) {
    const payload = await toolApprovalRequestedEvent.decode(event.payload)
    await db.execute({
      sql: `
        INSERT INTO specter_code_permissions (
          request_id,
          session_id,
          message_id,
          tool_call_id,
          tool_name,
          permission,
          target,
          action,
          status,
          reason,
          requested_at
        ) VALUES (?, ?, ?, (SELECT id FROM specter_code_tool_calls WHERE id = ?), ?, ?, ?, 'ask', 'pending', ?, ?)
        ON CONFLICT(request_id) DO UPDATE SET
          session_id = excluded.session_id,
          message_id = excluded.message_id,
          tool_call_id = excluded.tool_call_id,
          tool_name = excluded.tool_name,
          permission = excluded.permission,
          target = excluded.target,
          action = 'ask',
          status = 'pending',
          reason = excluded.reason,
          requested_at = excluded.requested_at,
          replied_at = NULL,
          replied_by_json = NULL
      `,
      args: [
        payload.requestId,
        payload.sessionId,
        payload.messageId,
        payload.toolCallId ?? null,
        payload.toolName,
        payload.permission,
        payload.target,
        payload.reason ?? null,
        event.recordedAt,
      ],
    })
    return
  }

  if (event.type === toolApprovalRepliedEvent.type) {
    const payload = await toolApprovalRepliedEvent.decode(event.payload)
    await db.execute({
      sql: `
        UPDATE specter_code_permissions
        SET action = ?,
            status = 'resolved',
            replied_at = ?,
            replied_by_json = ?,
            reason = COALESCE(?, reason)
        WHERE request_id = ? AND session_id = ?
      `,
      args: [
        payload.action,
        event.recordedAt,
        payload.repliedBy ? JSON.stringify(payload.repliedBy) : null,
        payload.reason ?? null,
        payload.requestId,
        payload.sessionId,
      ],
    })
  }
}
