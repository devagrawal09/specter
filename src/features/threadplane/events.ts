import z from 'zod'
import { createEventSpec } from '../../lib'

const workspaceId = z.string().min(1)

type WorkspaceNode = {
  id: string
  kind: 'dir' | 'file'
  name: string
  path: string
  children?: WorkspaceNode[]
}

const workspaceNode: z.ZodType<WorkspaceNode> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    kind: z.enum(['dir', 'file']),
    name: z.string().min(1),
    path: z.string().min(1),
    children: z.array(workspaceNode).optional(),
  }),
)

export const threadplaneWorkspaceCreatedEvent = createEventSpec(
  'threadplaneWorkspaceCreated',
  z.object({
    workspaceId,
    name: z.string().min(1),
  }),
)

export const threadplaneMessagePostedEvent = createEventSpec(
  'threadplaneMessagePosted',
  z.object({
    workspaceId,
    messageId: z.string().min(1),
    parentId: z.string().min(1).optional(),
    authorType: z.enum(['agent', 'system', 'user']),
    authorName: z.string().min(1),
    content: z.string(),
    createdAt: z.string().min(1),
  }),
)

export const threadplaneAgentUpdatedEvent = createEventSpec(
  'threadplaneAgentUpdated',
  z.object({
    workspaceId,
    agentId: z.string().min(1),
    agent: z.record(z.string(), z.unknown()),
  }),
)

export const threadplaneWorkspaceTreeChangedEvent = createEventSpec(
  'threadplaneWorkspaceTreeChanged',
  z.object({
    workspaceId,
    tree: z.array(workspaceNode),
  }),
)

export const threadplaneFileWrittenEvent = createEventSpec(
  'threadplaneFileWritten',
  z.object({
    workspaceId,
    path: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
  }),
)

export type ThreadplaneEvent =
  | ReturnType<typeof threadplaneWorkspaceCreatedEvent.create>
  | ReturnType<typeof threadplaneMessagePostedEvent.create>
  | ReturnType<typeof threadplaneAgentUpdatedEvent.create>
  | ReturnType<typeof threadplaneWorkspaceTreeChangedEvent.create>
  | ReturnType<typeof threadplaneFileWrittenEvent.create>
