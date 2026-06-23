import { createServerFn } from '@tanstack/solid-start'
import { z } from 'zod'

const workspaceIdInput = z.object({ workspaceId: z.string() })

export const listSpecterCodeWorkspaces = createServerFn({
  method: 'GET',
}).handler(async () => {
  const { listSpecterCodeWorkspacesOnServer } = await import(
    './server-runtime.server'
  )
  return listSpecterCodeWorkspacesOnServer()
})

export const createSpecterCodeWorkspace = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ name: z.string() }))
  .handler(async ({ data }) => {
    const { createSpecterCodeWorkspaceOnServer } = await import(
      './server-runtime.server'
    )
    return createSpecterCodeWorkspaceOnServer(data)
  })


const sessionIdInput = z.object({ sessionId: z.string() })

export const createSpecterCodeSession = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      sessionId: z.string().optional(),
      workspaceId: z.string(),
      title: z.string(),
      directory: z.string(),
      agent: z.string(),
      model: z.object({ providerId: z.string(), modelId: z.string() }),
      createdBy: z
        .object({ userId: z.string().optional(), displayName: z.string() })
        .optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { createSpecterCodeSessionOnServer } = await import(
      './server-runtime.server'
    )
    return createSpecterCodeSessionOnServer(data)
  })

export const listSpecterCodeSessions = createServerFn({ method: 'GET' })
  .inputValidator(workspaceIdInput)
  .handler(async ({ data }) => {
    const { listSpecterCodeSessionsOnServer } = await import(
      './server-runtime.server'
    )
    return listSpecterCodeSessionsOnServer(data)
  })

export const submitSpecterCodePrompt = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      messageId: z.string().optional(),
      runId: z.string().optional(),
      sessionId: z.string(),
      workspaceId: z.string(),
      content: z.string(),
      agentId: z.string(),
      agentName: z.string(),
      submittedBy: z.object({
        userId: z.string().optional(),
        displayName: z.string(),
      }),
    }),
  )
  .handler(async ({ data }) => {
    const { submitSpecterCodePromptOnServer } = await import(
      './server-runtime.server'
    )
    return submitSpecterCodePromptOnServer(data)
  })

export const listSpecterCodeSessionTranscript = createServerFn({ method: 'GET' })
  .inputValidator(sessionIdInput)
  .handler(async ({ data }) => {
    const { listSpecterCodeSessionTranscriptOnServer } = await import(
      './server-runtime.server'
    )
    return listSpecterCodeSessionTranscriptOnServer(data)
  })

export const createSpecterCodePost = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      workspaceId: z.string(),
      author: z.object({
        userId: z.string().optional(),
        displayName: z.string(),
      }),
      content: z.string(),
    }),
  )
  .handler(async ({ data }) => {
    const { createSpecterCodePostOnServer } = await import(
      './server-runtime.server'
    )
    return createSpecterCodePostOnServer(data)
  })

export const replyToSpecterCodePost = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      workspaceId: z.string(),
      parentPostId: z.string(),
      author: z.object({
        userId: z.string().optional(),
        displayName: z.string(),
      }),
      content: z.string(),
    }),
  )
  .handler(async ({ data }) => {
    const { replyToSpecterCodePostOnServer } = await import(
      './server-runtime.server'
    )
    return replyToSpecterCodePostOnServer(data)
  })

export const listSpecterCodeWorkspaceChat = createServerFn({ method: 'GET' })
  .inputValidator(workspaceIdInput)
  .handler(async ({ data }) => {
    const { listSpecterCodeWorkspaceChatOnServer } = await import(
      './server-runtime.server'
    )
    return listSpecterCodeWorkspaceChatOnServer(data)
  })

export const requestSpecterCodeFilesystemScan = createServerFn({
  method: 'POST',
})
  .inputValidator(
    z.object({
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
        z.object({ type: z.literal('system') }),
      ]),
    }),
  )
  .handler(async ({ data }) => {
    const { requestSpecterCodeFilesystemScanOnServer } = await import(
      './server-runtime.server'
    )
    return requestSpecterCodeFilesystemScanOnServer(data)
  })

export const listSpecterCodeFilesystemTree = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({
      workspaceId: z.string(),
      parentPath: z.string().nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { listSpecterCodeFilesystemTreeOnServer } = await import(
      './server-runtime.server'
    )
    return listSpecterCodeFilesystemTreeOnServer(data)
  })

export const getSpecterCodeFilesystemStatus = createServerFn({ method: 'GET' })
  .inputValidator(workspaceIdInput)
  .handler(async ({ data }) => {
    const { getSpecterCodeFilesystemStatusOnServer } = await import(
      './server-runtime.server'
    )
    return getSpecterCodeFilesystemStatusOnServer(data)
  })

export const requestSpecterCodeAgentRun = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
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
        z.object({ type: z.literal('system') }),
      ]),
    }),
  )
  .handler(async ({ data }) => {
    const { requestSpecterCodeAgentRunOnServer } = await import(
      './server-runtime.server'
    )
    return requestSpecterCodeAgentRunOnServer(data)
  })

export const listSpecterCodeWorkspaceAgentRuns = createServerFn({
  method: 'GET',
})
  .inputValidator(workspaceIdInput)
  .handler(async ({ data }) => {
    const { listSpecterCodeWorkspaceAgentRunsOnServer } = await import(
      './server-runtime.server'
    )
    return listSpecterCodeWorkspaceAgentRunsOnServer(data)
  })

export const listSpecterCodeAgentRunTimeline = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ workspaceId: z.string(), runId: z.string() }))
  .handler(async ({ data }) => {
    const { listSpecterCodeAgentRunTimelineOnServer } = await import(
      './server-runtime.server'
    )
    return listSpecterCodeAgentRunTimelineOnServer(data)
  })

export const readSpecterCodeWorkspaceTextFile = createServerFn({
  method: 'GET',
})
  .inputValidator(z.object({ workspaceId: z.string(), path: z.string() }))
  .handler(async ({ data }) => {
    const { readSpecterCodeWorkspaceTextFileOnServer } = await import(
      './server-runtime.server'
    )
    return readSpecterCodeWorkspaceTextFileOnServer(data)
  })
