import { createEventDefinition } from '@specter-ts/core'
import { z } from 'zod'

const fileSnapshotSchema = z.object({
  path: z.string(),
  existed: z.boolean(),
  content: z.string().optional(),
})

export const workspaceCreatedEvent = createEventDefinition(
  'workspace-created',
  z.object({
    workspaceId: z.string(),
    name: z.string(),
    createdBy: z
      .object({
        userId: z.string().optional(),
        displayName: z.string(),
      })
      .optional(),
  }),
)

export const sessionCreatedEvent = createEventDefinition(
  'session-created',
  z.object({
    sessionId: z.string(),
    parentSessionId: z.string().optional(),
    workspaceId: z.string(),
    title: z.string(),
    directory: z.string(),
    agent: z.string(),
    model: z.object({
      providerId: z.string(),
      modelId: z.string(),
    }),
    createdBy: z
      .object({
        userId: z.string().optional(),
        displayName: z.string(),
      })
      .optional(),
  }),
)

export const sessionUpdatedEvent = createEventDefinition(
  'session-updated',
  z.object({
    sessionId: z.string(),
    title: z.string().optional(),
    directory: z.string().optional(),
    agent: z.string().optional(),
    model: z
      .object({
        providerId: z.string(),
        modelId: z.string(),
      })
      .optional(),
    updatedBy: z
      .object({
        userId: z.string().optional(),
        displayName: z.string(),
      })
      .optional(),
  }),
)

export const sessionDeletedEvent = createEventDefinition(
  'session-deleted',
  z.object({
    sessionId: z.string(),
    deletedBy: z
      .object({
        userId: z.string().optional(),
        displayName: z.string(),
      })
      .optional(),
  }),
)

export const postCreatedEvent = createEventDefinition(
  'post-created',
  z.object({
    postId: z.string(),
    workspaceId: z.string(),
    author: z.discriminatedUnion('type', [
      z.object({
        type: z.literal('user'),
        userId: z.string().optional(),
        displayName: z.string(),
      }),
      z.object({
        type: z.literal('agent'),
        agentId: z.string(),
        displayName: z.string(),
      }),
    ]),
    content: z.string(),
    sourceRunId: z.string().optional(),
  }),
)

export const postReplyCreatedEvent = createEventDefinition(
  'post-reply-created',
  z.object({
    replyId: z.string(),
    workspaceId: z.string(),
    parentPostId: z.string(),
    author: z.discriminatedUnion('type', [
      z.object({
        type: z.literal('user'),
        userId: z.string().optional(),
        displayName: z.string(),
      }),
      z.object({
        type: z.literal('agent'),
        agentId: z.string(),
        displayName: z.string(),
      }),
    ]),
    content: z.string(),
    sourceRunId: z.string().optional(),
  }),
)

export const workspaceFilesystemInitializedEvent = createEventDefinition(
  'workspace-filesystem-initialized',
  z.object({
    workspaceId: z.string(),
  }),
)

export const workspaceFilesystemScanRequestedEvent = createEventDefinition(
  'workspace-filesystem-scan-requested',
  z.object({
    scanId: z.string(),
    workspaceId: z.string(),
    reason: z.enum(['workspaceCreated', 'userRequested', 'agentToolChanged']),
    requestedBy: z.discriminatedUnion('type', [
      z.object({
        type: z.literal('user'),
        userId: z.string().optional(),
        displayName: z.string(),
      }),
      z.object({
        type: z.literal('agent'),
        agentId: z.string(),
        displayName: z.string(),
      }),
      z.object({
        type: z.literal('system'),
      }),
    ]),
  }),
)

export const workspaceFilesystemScanStartedEvent = createEventDefinition(
  'workspace-filesystem-scan-started',
  z.object({
    scanId: z.string(),
    workspaceId: z.string(),
  }),
)

export const workspaceFilesystemScanCompletedEvent = createEventDefinition(
  'workspace-filesystem-scan-completed',
  z.object({
    scanId: z.string(),
    workspaceId: z.string(),
    discoveredNodeCount: z.number().int().nonnegative(),
    changedNodeCount: z.number().int().nonnegative(),
    deletedNodeCount: z.number().int().nonnegative(),
  }),
)

export const workspaceFilesystemScanFailedEvent = createEventDefinition(
  'workspace-filesystem-scan-failed',
  z.object({
    scanId: z.string(),
    workspaceId: z.string(),
    error: z.string(),
  }),
)

export const filesystemNodeDiscoveredEvent = createEventDefinition(
  'filesystem-node-discovered',
  z.object({
    scanId: z.string(),
    workspaceId: z.string(),
    path: z.string(),
    parentPath: z.string().nullable(),
    name: z.string(),
    kind: z.enum(['file', 'directory']),
    sizeBytes: z.number().int().nonnegative().nullable(),
    modifiedAt: z.string().optional(),
  }),
)

export const filesystemNodeChangedEvent = createEventDefinition(
  'filesystem-node-changed',
  z.object({
    scanId: z.string(),
    workspaceId: z.string(),
    path: z.string(),
    parentPath: z.string().nullable(),
    name: z.string(),
    kind: z.enum(['file', 'directory']),
    sizeBytes: z.number().int().nonnegative().nullable(),
    modifiedAt: z.string().optional(),
  }),
)

export const filesystemNodeDeletedEvent = createEventDefinition(
  'filesystem-node-deleted',
  z.object({
    scanId: z.string(),
    workspaceId: z.string(),
    path: z.string(),
  }),
)

export const userMessageSubmittedEvent = createEventDefinition(
  'user-message-submitted',
  z.object({
    messageId: z.string(),
    sessionId: z.string(),
    workspaceId: z.string(),
    content: z.string(),
    submittedBy: z.object({
      userId: z.string().optional(),
      displayName: z.string(),
    }),
  }),
)

export const sessionMessagePartUpdatedEvent = createEventDefinition(
  'session-message-part-updated',
  z.object({
    sessionId: z.string(),
    messageId: z.string(),
    partId: z.string(),
    content: z.string(),
  }),
)

export const sessionMessagePartDeletedEvent = createEventDefinition(
  'session-message-part-deleted',
  z.object({
    sessionId: z.string(),
    messageId: z.string(),
    partId: z.string(),
  }),
)

export const sessionMessageDeletedEvent = createEventDefinition(
  'session-message-deleted',
  z.object({
    sessionId: z.string(),
    messageId: z.string(),
    deletedBy: z
      .object({
        userId: z.string().optional(),
        displayName: z.string(),
      })
      .optional(),
    reason: z.string().optional(),
  }),
)

export const agentRunRequestedEvent = createEventDefinition(
  'agent-run-requested',
  z.object({
    runId: z.string(),
    workspaceId: z.string(),
    postId: z.string().optional(),
    agentId: z.string(),
    agentName: z.string(),
    requestedBy: z.discriminatedUnion('type', [
      z.object({
        type: z.literal('user'),
        userId: z.string().optional(),
        displayName: z.string(),
      }),
      z.object({
        type: z.literal('agent'),
        agentId: z.string(),
        displayName: z.string(),
      }),
      z.object({
        type: z.literal('system'),
      }),
    ]),
  }),
)

export const agentRunStartedEvent = createEventDefinition(
  'agent-run-started',
  z.object({
    runId: z.string(),
    workspaceId: z.string(),
    agentId: z.string(),
  }),
)

export const agentRunStreamedEvent = createEventDefinition(
  'agent-run-streamed',
  z.object({
    runId: z.string(),
    workspaceId: z.string(),
    agentId: z.string(),
    chunkId: z.string(),
    sequence: z.number().int().nonnegative(),
    delta: z.string(),
  }),
)

export const agentRunCompletedEvent = createEventDefinition(
  'agent-run-completed',
  z.object({
    runId: z.string(),
    workspaceId: z.string(),
    agentId: z.string(),
  }),
)

export const agentRunFailedEvent = createEventDefinition(
  'agent-run-failed',
  z.object({
    runId: z.string(),
    workspaceId: z.string(),
    agentId: z.string(),
    error: z.string(),
  }),
)

export const toolCallStartedEvent = createEventDefinition(
  'tool-call-started',
  z.object({
    toolCallId: z.string(),
    runId: z.string(),
    workspaceId: z.string(),
    agentId: z.string(),
    toolName: z.string(),
    inputSummary: z.string().optional(),
  }),
)

export const toolCallCompletedEvent = createEventDefinition(
  'tool-call-completed',
  z.object({
    toolCallId: z.string(),
    runId: z.string(),
    workspaceId: z.string(),
    agentId: z.string(),
    toolName: z.string(),
    outputSummary: z.string().optional(),
  }),
)

export const toolCallFailedEvent = createEventDefinition(
  'tool-call-failed',
  z.object({
    toolCallId: z.string(),
    runId: z.string(),
    workspaceId: z.string(),
    agentId: z.string(),
    toolName: z.string(),
    error: z.string(),
  }),
)

export const toolApprovalRequestedEvent = createEventDefinition(
  'tool-approval-requested',
  z.object({
    requestId: z.string(),
    sessionId: z.string(),
    messageId: z.string(),
    workspaceId: z.string(),
    agentId: z.string(),
    toolCallId: z.string().optional(),
    toolName: z.string(),
    permission: z.string(),
    target: z.string(),
    reason: z.string().optional(),
  }),
)

export const toolApprovalRepliedEvent = createEventDefinition(
  'tool-approval-replied',
  z.object({
    requestId: z.string(),
    sessionId: z.string(),
    action: z.enum(['allow', 'deny']),
    repliedBy: z
      .object({
        userId: z.string().optional(),
        displayName: z.string(),
      })
      .optional(),
    reason: z.string().optional(),
  }),
)

export const sessionRevertRequestedEvent = createEventDefinition(
  'session-revert-requested',
  z.object({
    revertId: z.string(),
    sessionId: z.string(),
    workspaceId: z.string(),
    snapshots: z.array(fileSnapshotSchema).min(1),
    requestedBy: z
      .object({
        userId: z.string().optional(),
        displayName: z.string(),
      })
      .optional(),
    reason: z.string().optional(),
  }),
)

export const todoListUpdatedEvent = createEventDefinition(
  'todo-list-updated',
  z.object({
    sessionId: z.string(),
    messageId: z.string(),
    items: z.array(
      z.object({
        id: z.string(),
        content: z.string(),
        status: z.enum(['pending', 'in_progress', 'completed']),
        priority: z.enum(['low', 'medium', 'high']).optional(),
      }),
    ),
  }),
)

export const questionAskedEvent = createEventDefinition(
  'question-asked',
  z.object({
    questionId: z.string(),
    sessionId: z.string(),
    messageId: z.string(),
    prompt: z.string(),
    options: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
      }),
    ),
    allowFreeform: z.boolean(),
  }),
)

export const questionAnsweredEvent = createEventDefinition(
  'question-answered',
  z.object({
    questionId: z.string(),
    sessionId: z.string(),
    answer: z.string(),
    answeredBy: z
      .object({
        userId: z.string().optional(),
        displayName: z.string(),
      })
      .optional(),
  }),
)

export const ptySessionStartedEvent = createEventDefinition(
  'pty-session-started',
  z.object({
    ptySessionId: z.string(),
    sessionId: z.string(),
    workspaceId: z.string(),
    cwd: z.string(),
    shell: z.string(),
    startedAt: z.string(),
  }),
)

export const ptySessionOutputEvent = createEventDefinition(
  'pty-session-output',
  z.object({
    ptySessionId: z.string(),
    sessionId: z.string(),
    stream: z.enum(['stdout', 'stderr']),
    data: z.string(),
    sequence: z.number().int().positive(),
    emittedAt: z.string(),
  }),
)

export const ptySessionEndedEvent = createEventDefinition(
  'pty-session-ended',
  z.object({
    ptySessionId: z.string(),
    sessionId: z.string(),
    exitCode: z.number().int().nullable(),
    signal: z.string().nullable(),
    status: z.enum(['exited', 'killed']),
    endedAt: z.string(),
  }),
)

export const specterCodeEventDefinitions = [
  workspaceCreatedEvent,
  sessionCreatedEvent,
  sessionUpdatedEvent,
  sessionDeletedEvent,
  postCreatedEvent,
  postReplyCreatedEvent,
  workspaceFilesystemInitializedEvent,
  workspaceFilesystemScanRequestedEvent,
  workspaceFilesystemScanStartedEvent,
  workspaceFilesystemScanCompletedEvent,
  workspaceFilesystemScanFailedEvent,
  filesystemNodeDiscoveredEvent,
  filesystemNodeChangedEvent,
  filesystemNodeDeletedEvent,
  userMessageSubmittedEvent,
  sessionMessagePartUpdatedEvent,
  sessionMessagePartDeletedEvent,
  sessionMessageDeletedEvent,
  agentRunRequestedEvent,
  agentRunStartedEvent,
  agentRunStreamedEvent,
  agentRunCompletedEvent,
  agentRunFailedEvent,
  toolCallStartedEvent,
  toolCallCompletedEvent,
  toolCallFailedEvent,
  toolApprovalRequestedEvent,
  toolApprovalRepliedEvent,
  sessionRevertRequestedEvent,
  todoListUpdatedEvent,
  questionAskedEvent,
  questionAnsweredEvent,
  ptySessionStartedEvent,
  ptySessionOutputEvent,
  ptySessionEndedEvent,
] as const
