import { createServerFn } from '@tanstack/solid-start'
import { z } from 'zod'

const workspaceIdInput = z.object({ workspaceId: z.string() })

export const listThreadplaneWorkspaces = createServerFn({
  method: 'GET',
}).handler(async () => {
  const { listThreadplaneWorkspacesOnServer } = await import(
    './server-runtime.server'
  )
  return listThreadplaneWorkspacesOnServer()
})

export const createThreadplaneWorkspace = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      workspaceId: z.string(),
      scanId: z.string(),
      name: z.string(),
    }),
  )
  .handler(async ({ data }) => {
    const { createThreadplaneWorkspaceOnServer } = await import(
      './server-runtime.server'
    )
    return createThreadplaneWorkspaceOnServer(data)
  })

export const createThreadplanePost = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      workspaceId: z.string(),
      postId: z.string(),
      author: z.object({
        userId: z.string().optional(),
        displayName: z.string(),
      }),
      content: z.string(),
    }),
  )
  .handler(async ({ data }) => {
    const { createThreadplanePostOnServer } = await import(
      './server-runtime.server'
    )
    return createThreadplanePostOnServer(data)
  })

export const replyToThreadplanePost = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      workspaceId: z.string(),
      replyId: z.string(),
      parentPostId: z.string(),
      author: z.object({
        userId: z.string().optional(),
        displayName: z.string(),
      }),
      content: z.string(),
    }),
  )
  .handler(async ({ data }) => {
    const { replyToThreadplanePostOnServer } = await import(
      './server-runtime.server'
    )
    return replyToThreadplanePostOnServer(data)
  })

export const listThreadplaneWorkspaceChat = createServerFn({ method: 'GET' })
  .inputValidator(workspaceIdInput)
  .handler(async ({ data }) => {
    const { listThreadplaneWorkspaceChatOnServer } = await import(
      './server-runtime.server'
    )
    return listThreadplaneWorkspaceChatOnServer(data)
  })

export const requestThreadplaneFilesystemScan = createServerFn({
  method: 'POST',
})
  .inputValidator(
    z.object({
      workspaceId: z.string(),
      scanId: z.string(),
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
        z.object({ type: z.literal('system') }),
      ]),
    }),
  )
  .handler(async ({ data }) => {
    const { requestThreadplaneFilesystemScanOnServer } = await import(
      './server-runtime.server'
    )
    return requestThreadplaneFilesystemScanOnServer(data)
  })

export const listThreadplaneFilesystemTree = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({
      workspaceId: z.string(),
      parentPath: z.string().nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { listThreadplaneFilesystemTreeOnServer } = await import(
      './server-runtime.server'
    )
    return listThreadplaneFilesystemTreeOnServer(data)
  })

export const getThreadplaneFilesystemStatus = createServerFn({ method: 'GET' })
  .inputValidator(workspaceIdInput)
  .handler(async ({ data }) => {
    const { getThreadplaneFilesystemStatusOnServer } = await import(
      './server-runtime.server'
    )
    return getThreadplaneFilesystemStatusOnServer(data)
  })

export const requestThreadplaneAgentRun = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      workspaceId: z.string(),
      runId: z.string(),
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
        z.object({ type: z.literal('system') }),
      ]),
    }),
  )
  .handler(async ({ data }) => {
    const { requestThreadplaneAgentRunOnServer } = await import(
      './server-runtime.server'
    )
    return requestThreadplaneAgentRunOnServer(data)
  })

export const listThreadplaneWorkspaceAgentRuns = createServerFn({
  method: 'GET',
})
  .inputValidator(workspaceIdInput)
  .handler(async ({ data }) => {
    const { listThreadplaneWorkspaceAgentRunsOnServer } = await import(
      './server-runtime.server'
    )
    return listThreadplaneWorkspaceAgentRunsOnServer(data)
  })

export const listThreadplaneAgentRunTimeline = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ workspaceId: z.string(), runId: z.string() }))
  .handler(async ({ data }) => {
    const { listThreadplaneAgentRunTimelineOnServer } = await import(
      './server-runtime.server'
    )
    return listThreadplaneAgentRunTimelineOnServer(data)
  })

export const readThreadplaneWorkspaceTextFile = createServerFn({
  method: 'GET',
})
  .inputValidator(z.object({ workspaceId: z.string(), path: z.string() }))
  .handler(async ({ data }) => {
    const { readThreadplaneWorkspaceTextFileOnServer } = await import(
      './server-runtime.server'
    )
    return readThreadplaneWorkspaceTextFileOnServer(data)
  })
