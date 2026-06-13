import { createServerFn } from '@tanstack/solid-start'
import { z } from 'zod'

export const postChatMessage = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      workspaceId: z.string(),
      authorName: z.string(),
      content: z.string(),
    }),
  )
  .handler(async ({ data }) => {
    const { postChatMessageOnServer } = await import('./server-runtime.server')

    await postChatMessageOnServer(data)
  })

export const listWorkspaceMessages = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({
      workspaceId: z.string(),
    }),
  )
  .handler(async ({ data }) => {
    const { listWorkspaceMessagesOnServer } = await import(
      './server-runtime.server'
    )

    return listWorkspaceMessagesOnServer(data)
  })

export const createWorkspace = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      name: z.string(),
    }),
  )
  .handler(async ({ data }) => {
    const { createWorkspaceOnServer } = await import('./server-runtime.server')

    return createWorkspaceOnServer(data)
  })

export const listWorkspaces = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { listWorkspacesOnServer } = await import('./server-runtime.server')

    return listWorkspacesOnServer()
  },
)
